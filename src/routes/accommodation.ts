// accommodation.ts
import type { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BulkBookingResponse, FetchBookingResponse } from "../lib/tiqr";

const ACCOMMODATION_COLLECTION = "accommodation_registrations";

const Accommodation: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user", null);
  
  // Auth Hook
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

  // POST: Book Group Accommodation (Bulk Members, Individual Entries)
  fastify.post("/accommodation/book", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = AccommodationGroupPayload.safeParse(request.body);

    if (!body.success) {
      reply.status(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    const { members, college, teamName, preferences } = body.data;

    // 1. Prepare TiQR Bulk Payload
    const bookings = members.map((member, index) => ({
      first_name: member.name.split(" ")[0],
      last_name: member.name.split(" ").slice(1).join(" ") || "Member",
      phone_number: member.phone,
      email: member.email,
      ticket: Tickets.Accommodation,
      meta_data: {
        gender: member.gender,
        college,
        teamName,
        index,
      },
    }));

    // 2. Call TiQR Bulk Booking
    const tiqrResponse = await TiQR.createBulkBooking({ bookings });
    const tiqrData = (await tiqrResponse.json()) as BulkBookingResponse;

    const groupId = tiqrData.booking.uid; // Parent UID for linking
    const paymentUrl = tiqrData.payment.url_to_redirect;

    // 3. Batch write to Firestore (1-1 entry per member)
    const batch = db.batch();

    tiqrData.booking.child_bookings.forEach((child: any, i: number) => {
      const member = members[i];
      const docRef = db.collection(ACCOMMODATION_COLLECTION).doc(child.uid);
      
      batch.set(docRef, {
        ownerUID: user.uid, // The leader who booked
        name: member.name,
        email: member.email,
        phone: member.phone,
        gender: member.gender,
        college,
        teamName,
        groupId, // Common for all team members
        tiqrBookingUid: child.uid,
        paymentStatus: child.status as PaymentStatus,
        paymentUrl: paymentUrl || "",
        preferences: preferences || "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    reply.code(200);
    return {
      success: true,
      message: `Successfully initiated booking for ${members.length} members`,
      groupId,
      paymentUrl,
    };
  });

  // GET: Sync and fetch individual member status (Mirrors /merch/order/:id)
  fastify.get("/accommodation/order/:id", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const params = request.params as { id?: string };
    const id = (params?.id || "").trim();

    if (!id) {
      reply.code(400);
      return { error: true, message: "Missing booking id" };
    }

    const docRef = db.collection(ACCOMMODATION_COLLECTION).doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      reply.code(404);
      return { error: true, message: "Booking entry not found" };
    }

    const order = snap.data() as AccommodationSchema;

    // Sync if not confirmed
    if (order.paymentStatus !== PaymentStatus.Confirmed) {
      const tiqrResponse = await TiQR.fetchBooking(id);
      const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

      if (tiqrData.status && tiqrData.status !== order.paymentStatus) {
        await docRef.update({
          paymentStatus: tiqrData.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        order.paymentStatus = tiqrData.status as PaymentStatus;
      }
    }

    return {
      success: true,
      bookingId: id,
      status: order.paymentStatus,
      paymentUrl: order.paymentUrl,
      details: {
        name: order.name,
        teamName: order.teamName,
        ownerUID: order.ownerUID,
      }
    };
  });

  // ADMIN: Dashboard View (Grouped by groupId/teamName)
  fastify.get("/accommodation/admin/all", async function (request, reply) {
    try {
      request.getDecorator<DecodedIdToken>("user");
      const snap = await db.collection(ACCOMMODATION_COLLECTION).get();
      const allEntries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const teams = allEntries.reduce((acc: any, curr: any) => {
        const key = curr.groupId || "Individual";
        if (!acc[key]) {
          acc[key] = { 
            teamName: curr.teamName, 
            ownerUID: curr.ownerUID,
            count: 0, 
            members: [] 
          };
        }
        acc[key].members.push(curr);
        acc[key].count++;
        return acc;
      }, {});

      return {
        success: true,
        total_registrations: allEntries.length,
        teams,
      };
    } catch (err) {
      reply.status(500);
      return { error: true, message: "Failed to fetch admin dashboard", details: String(err) };
    }
  });
};

// Zod Validation
const AccommodationGroupPayload = z.object({
  college: z.string().min(1),
  teamName: z.string().min(1),
  preferences: z.string().optional(),
  members: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(10),
    gender: z.enum(["male", "female", "other"]),
  })).min(1),
});

// Interface for Firestore
interface AccommodationSchema extends Record<string, any> {
  ownerUID: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  college: string;
  teamName: string;
  groupId: string;
  tiqrBookingUid: string;
  paymentStatus: PaymentStatus | string;
  paymentUrl: string;
  createdAt: FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FieldValue | FirebaseFirestore.Timestamp;
}

export default Accommodation;