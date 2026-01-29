// accommodation.ts
import type { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import z from "zod";
import { EventMappings, PaymentStatus, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BulkBookingResponse, FetchBookingResponse } from "../lib/tiqr";

const ACCOMMODATION_COLLECTION = EventMappings[Tickets.Accommodation];

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

  // POST: Book Group Accommodation (Single Group Document)
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

    const { members, college, teamName, preferences, eventId } = body.data;

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

    // 3. Save Single Group Document to Firestore
    const docRef = db.collection(ACCOMMODATION_COLLECTION).doc(groupId);

    await docRef.set({
      ownerUID: user.uid,
      eventId,
      college,
      teamName, // Validated manually if needed or assumed unique by usage
      paymentUrl: paymentUrl || "",
      paymentStatus: (tiqrData.booking.status as PaymentStatus) || PaymentStatus.PendingPayment,
      preferences: preferences || "",
      members,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    reply.code(200);
    return {
      success: true,
      message: `Successfully initiated booking for ${members.length} members`,
      groupId,
      paymentUrl,
    };
  });

  // GET: Sync and fetch group booking status
  fastify.get("/accommodation/order/:id", async function (request, reply) {
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

    const groupOrder = snap.data() as AccommodationGroupSchema;

    // Sync if not confirmed
    if (groupOrder.paymentStatus !== PaymentStatus.Confirmed) {
      // Fetch status using the Group ID (Parent Booking)
      const tiqrResponse = await TiQR.fetchBooking(id);
      const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

      if (tiqrData.status && tiqrData.status !== groupOrder.paymentStatus) {
         // Update root status
        await docRef.update({
          paymentStatus: tiqrData.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        groupOrder.paymentStatus = tiqrData.status as PaymentStatus;
        
        // Optionally update member statuses if TiQR provides them in fetch payload (TiQR specific)
        // For now, updating the main group status is the primary requirement for unlocking access.
      }
    }

    return {
      success: true,
      bookingId: id,
      status: groupOrder.paymentStatus,
      paymentUrl: groupOrder.paymentUrl,
      details: groupOrder
    };
  });

  // GET: Fetch All Group Bookings (User's History)
  fastify.get("/accommodation/all", async function (request, reply) {
    try {
      const user = request.getDecorator<DecodedIdToken>("user");
      // Filter by ownerUID to show only the user's bookings
      const snap = await db.collection(ACCOMMODATION_COLLECTION)
        .where("ownerUID", "==", user.uid)
        .get();

      const allGroups = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return {
        success: true,
        total_groups: allGroups.length,
        bookings: allGroups,
      };
    } catch (err) {
      reply.status(500);
      return { error: true, message: "Failed to fetch accommodation bookings", details: String(err) };
    }
  });
};

// Zod Validation
const AccommodationGroupPayload = z.object({
  eventId: z.coerce.number().int().positive(),
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

// Interface for Firestore (Group Schema)
interface AccommodationGroupSchema extends Record<string, any> {
  ownerUID: string;
  eventId: number;
  college: string;
  teamName: string;
  paymentUrl: string;
  paymentStatus: PaymentStatus | string;
  preferences: string;
  members: Array<{
    tiqrBookingUid: string;
    name: string;
    email: string;
    phone: string;
    gender: string;
    status: PaymentStatus;
  }>;
  createdAt: FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FieldValue | FirebaseFirestore.Timestamp;
}

export default Accommodation;