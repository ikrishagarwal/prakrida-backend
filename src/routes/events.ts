import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import { Tickets } from "../constants";
import { eventMappings } from "../constants";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

interface EventBooking {
  status: "pending" | "confirmed";
  type: "solo" | "team";
  paymentUrl?: string;
  updatedAt: FirebaseFirestore.Timestamp;
}

const Event: FastifyPluginAsync = async (fastify): Promise<any> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);
    if (!user) {
      reply //
        .code(401)
        .send({ error: "Unauthorized" });
      return;
    }

    request.setDecorator("user", user);
  });

  fastify.post("/events/book", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const { eventId, type, } = request.body as {
    eventId: number;
    type: "solo" | "group";
  };

    const userRef = db
    .collection("events_registrations")
    .doc(user.uid);

    const docSnap = await userRef.get();

    const eventPath = `events.${eventId}`;

    if (docSnap.exists && docSnap.get(eventPath)) {
      return reply.code(409).send({
        error: "Already registered for this event",
      });
    }

    const eventData = {
      paymentUrl: "",
      status: "confirmed",
      type,
      updatedAt: new Date(),
    };

    // 🆕 First time user
    if (!docSnap.exists) {
      await userRef.set({
        email: user.email,
        createdAt: new Date(),
        events: {
          [eventId]: eventData,
        },
        name: user.name,
        phone: user.phone_number
      });
    } 
    // ➕ Existing user, new event
    else {
      await userRef.update({
        [eventPath]: eventData,
      });
    }

    return {
      message: "Event booked successfully",
      eventId,
      status: "confirmed",
    };
});

  fastify.get("/events/status/:eventId", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const { eventId } = request.params as { eventId: string };

    const userRef = db
    .collection("events_registrations")
    .doc(user.uid);

    const userSnap = await userRef.get();

    // User never registered for any event
    if (!userSnap.exists) {
      return {
        eventId,
        status: "not_registered",
      };
    }

    // Path: events.2 / events.116
    const eventPath = `events.${eventId}`;
    const eventData = userSnap.get(eventPath);

    // User exists but not for this event
    if (!eventData) {
      return {
        eventId,
        status: "not_registered",
      };
    }

    // User registered for this event
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
    const userRef = db
        .collection("events_registrations")
        .doc(user.uid);

      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return {
          count: 0,
          events: [],
        };
      }

      const data = userSnap.data() as {
  events?: Record<string, EventBooking>;
};;
      const eventsMap = data?.events ?? {};

      const results = Object.entries(eventsMap).map(
        ([eventId, eventData]) => ({
          eventId,
          ...eventData,
        })
      );

      return {
        count: results.length,
        events: results,
      };
    });
};

export default Event;
