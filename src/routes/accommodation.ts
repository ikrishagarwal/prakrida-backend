// accommodation.ts
// Fastify endpoints for accommodation registration and status
import type { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { FetchBookingResponse, BulkBookingResponse } from "../lib/tiqr";

const Accommodation: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);
    if (!user) {
      return await reply.code(401).send({
        error: true,
        message: "unauthorized",
      });
    }
    request.setDecorator("user", user);
  });

  fastify.post("/accommodation/book", async function (request, reply) {
    // const user = request.getDecorator<DecodedIdToken>("user");
    const body = AccommodationGroupBookingPayload.safeParse(request.body);
    if (!body.success) {
      reply.status(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }
    const { members, college } = body.data;
    if (!Array.isArray(members) || members.length === 0) {
      reply.status(400);
      return {
        error: true,
        message: "At least one member is required",
      };
    }
    // Create bulk booking payload
    const bookings = members.map((member, i) => ({
      first_name: member.name.split(" ")[0],
      last_name: member.name.split(" ").slice(1).join(" "),
      phone_number: member.phone,
      email: member.email,
      ticket: Tickets.Accommodation,
      meta_data: {
        gender: member.gender,
        college,
        index: i,
      },
    }));
    const tiqrResponse = await TiQR.createBulkBooking({ bookings });
    const tiqrData = (await tiqrResponse.json()) as BulkBookingResponse;

    // Store booking/payment info for each member in Firestore
    const batch = db.batch();
    (tiqrData.booking.child_bookings as Array<any>).forEach((childBooking: any, i: number) => {
      const member = members[i];
      if (!member) return;
      const docRef = db.collection("accommodation_group_members").doc(childBooking.uid);
      batch.set(docRef, {
        name: member.name,
        email: member.email,
        phone: member.phone,
        gender: member.gender,
        college,
        tiqrBookingUid: childBooking.uid,
        paymentStatus: childBooking.status,
        paymentUrl: tiqrData.payment.url_to_redirect || "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    return {
      success: true,
      message: `Booked accommodation for ${members.length} members successfully`,
      paymentUrl: tiqrData.payment.url_to_redirect,
      bookingUids: (tiqrData.booking.child_bookings as Array<any>).map((b: any) => b.uid),
    };
  });

  fastify.get("/accommodation/status", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const userSnap = await db.collection("accommodation").doc(user.uid).get();
    if (!userSnap.exists) {
      reply.code(404);
      return {
        error: true,
        message: "No registration found for this user",
      };
    }
    const userData = userSnap.data() as AccommodationSchema;
    if (!userData.tiqrBookingUid) {
      reply.code(404);
      return {
        error: true,
        message: "No booking found for this event",
      };
    }
    if (userData.paymentStatus === PaymentStatus.Confirmed) {
      reply.code(200);
      return {
        success: true,
        phone: userData.phone,
        college: userData.college,
        name: userData.name,
        status: PaymentStatus.Confirmed,
        message: "Registration confirmed",
      };
    }
    const tiqrResponse = await TiQR.fetchBooking(userData.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;
    if (tiqrData.status && tiqrData.status !== userData.paymentStatus) {
      await userSnap.ref.update({
        paymentStatus: tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      success: true,
      status: tiqrData.status,
      phone: userData.phone,
      college: userData.college,
      name: userData.name,
      message: "Status fetched successfully",
    };
  });

};


const AccommodationGroupBookingPayload = z.object({
  college: z.string().min(1),
  preferences: z.string().optional(),
  members: z.array(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(10),
      gender: z.enum(["male", "female", "other"]),
    })
  ).min(1),
});

interface AccommodationSchema extends Record<string, any> {
  name: string;
  email: string;
  phone: string;
  college: string;
  preferences?: string;
  tiqrBookingUid?: string;
  paymentStatus?: PaymentStatus;
  createdAt: FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.FieldValue;
}

export default Accommodation;
