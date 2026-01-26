import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import { eventMappings } from "../constants";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/firebase";
import TiQR, { BookingResponse, FetchBookingResponse } from "../lib/tiqr";
import { PaymentStatus } from "../constants";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";

interface EventBooking {
  status: PaymentStatus;
  type: "solo" | "group";
  members?: { name: string; email: string; phone: string }[];
  paymentUrl?: string;
  tiqrBookingUid: string;
  updatedAt: FirebaseFirestore.Timestamp;
  college?: string;
}

const Event: FastifyPluginAsync = async (fastify): Promise<any> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);
    if (!user) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    request.setDecorator("user", user);
  });

  fastify.post("/events/book", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");

    const body = BookEventsPayload.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return {
        error: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    const { eventId, type, members, name, phone, college } = body.data;

    const ticketId = eventMappings[eventId];

    if (!ticketId) {
      return reply.code(400).send({ error: "Invalid eventId" });
    }

    if (type === "group" && !members?.length) {
      return reply
        .code(400)
        .send({ error: "Group events require members list" });
    }

    const userRef = db.collection("events_registrations").doc(user.uid);

    const docSnap = await userRef.get();
    const eventPath = `events.${eventId}`;

    const existingEvent = docSnap.exists ? docSnap.get(eventPath) : null;

    if (existingEvent && existingEvent.status === PaymentStatus.Confirmed) {
      return reply
        .code(409)
        .send({ error: "Already registered for this event" });
    }

    const bookingPayload = {
      first_name: name?.split(" ")[0] ?? "User",
      last_name: name?.split(" ").slice(1).join(" ") ?? "",
      email: user.email!,
      phone_number: phone ?? "",
      ticket: ticketId,
      meta_data: {
        uid: user.uid,
        eventId,
        type,
        college,
        members: members ?? [],
      },
    };

    const tiqrRes = await TiQR.createBooking(bookingPayload);
    const tiqrData = (await tiqrRes.json()) as BookingResponse;

    const paymentUrl = tiqrData.payment.url_to_redirect;

    const eventData: EventBooking = {
      paymentUrl,
      tiqrBookingUid: tiqrData.booking.uid,
      status: PaymentStatus.PendingPayment,
      type,
      members: members ?? [],
      college,
      updatedAt: FieldValue.serverTimestamp() as Timestamp,
    };

    if (!docSnap.exists) {
      await userRef.set({
        email: user.email,
        name: name,
        phone: phone ?? "",
        createdAt: FieldValue.serverTimestamp(),
        events: {
          [eventId]: eventData,
        },
      });
    } else {
      await userRef.update({
        college,
        [eventPath]: eventData,
      });
    }

    return {
      message: "Booking created",
      status: PaymentStatus.PendingPayment,
      paymentUrl,
    };
  });

  fastify.get("/events/status/:eventId", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const { eventId } = request.params as { eventId: string };

    const userRef = db.collection("events_registrations").doc(user.uid);

    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return {
        eventId,
        status: "not_registered",
      };
    }

    const eventPath = `events.${eventId}`;
    const eventData = userSnap.get(eventPath);

    if (!eventData) {
      return { eventId, status: "not_registered" };
    }

    if (eventData.status !== PaymentStatus.Confirmed) {
      try {
        const res = await TiQR.fetchBooking(eventData.tiqrBookingUid);
        const bookingData = (await res.json()) as FetchBookingResponse;
        const tiqrStatus = bookingData.status;

        if (tiqrStatus !== eventData.status) {
          await userRef.update({
            [`events.${eventId}.status`]: tiqrStatus,
            [`events.${eventId}.updatedAt`]: FieldValue.serverTimestamp(),
          });
          eventData.status = tiqrStatus;
        }
      } catch (err) {
        console.error("Error fetching TiQR status:", err);
      }
    }

    return {
      eventId,
      status: eventData.status,
      type: eventData.type,
      paymentUrl: eventData.paymentUrl ?? "",
      updatedAt: eventData.updatedAt,
    };
  });

  fastify.get("/events/registered", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userRef = db.collection("events_registrations").doc(user.uid);

    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return {
        count: 0,
        events: [],
      };
    }

    const data = userSnap.data() as {
      events?: Record<string, EventBooking>;
    };
    const eventsMap = data?.events ?? {};

    const results = Object.entries(eventsMap).map(([eventId, eventData]) => ({
      eventId,
      ...eventData,
    }));

    return {
      count: results.length,
      events: results,
    };
  });
};

const BookEventsPayload = z.object({
  eventId: z.coerce.number().min(1),
  type: z.enum(["solo", "group"]),
  members: z
    .array(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(10),
      }),
    )
    .optional(),
  name: z.string().min(1),
  phone: z.string().min(10),
  college: z.string().min(1),
});

export default Event;
