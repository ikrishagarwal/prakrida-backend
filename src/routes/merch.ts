import { FastifyPluginAsync } from "fastify";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus } from "../constants"; // reuse same Tickets enum
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BookingResponse, FetchBookingResponse } from "../lib/tiqr";

const PRAKRIDA_MERCH_COLLECTION = "prakrida_merchandise";

// Prakrida merchandise ticket IDs from JusPay
const PrakridaTickets = {
  Single: 2668,      // Single merch ticket
  ComboTwo: 2669,    // Combo of 2 tees ticket
  ComboThree: 2670,  // Combo of 3 tees ticket
};

const PrakridaMerch: FastifyPluginAsync = async (fastify): Promise<void> => {
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

  fastify.post("/prakrida/merch/order", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const body = PrakridaMerchOrderPayload.safeParse(request.body);

    if (!body.success) {
      reply.code(400);
      return {
        error: true,
        message: "Invalid request body",
        details: z.prettifyError(body.error),
      };
    }

    // SECURITY: Cannot order more than 3 items total
    if (body.data.item.quantity > 3) {
      reply.code(400);
      return {
        error: true,
        message: "You cannot order more than 3 items",
      };
    }

    let ticketId: number; // ← explicitly number, like Technika

    switch (body.data.item.type) {
      case "single":
        ticketId = PrakridaTickets.Single;
        break;
      case "combo_two":
        ticketId = PrakridaTickets.ComboTwo;
        break;
      case "combo_three":
        ticketId = PrakridaTickets.ComboThree;
        break;
      default:
        reply.code(400);
        return {
          error: true,
          message: "Invalid merch item type",
        };
    }

    const [firstName, ...restName] = body.data.name.trim().split(/s+/);

    const tiqrResponse = await TiQR.createBooking({
      first_name: firstName,
      last_name: restName.join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: ticketId, // ← now number, TypeScript happy
      quantity: body.data.item.quantity,
      meta_data: {
        merch: {
          items: body.data.item,
        },
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;
    fastify.log.info(tiqrData);

    const orderId = tiqrData.booking.uid;

    const orderDoc: PrakridaMerchOrderDocument = {
      userId: user.uid,
      email: user.email || "",
      name: body.data.name,
      phone: body.data.phone,
      college: body.data.college,
      item: body.data.item,
      tiqrBookingUid: orderId,
      paymentStatus: tiqrData.booking.status as PaymentStatus,
      paymentUrl: tiqrData.payment.url_to_redirect || "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.collection(PRAKRIDA_MERCH_COLLECTION).doc(orderId).set(orderDoc);

    reply.code(200);
    return {
      success: true,
      message: "Created prakrida merch order successfully",
      orderId,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/prakrida/merch/orders", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const ordersSnap = await db
      .collection(PRAKRIDA_MERCH_COLLECTION)
      .where("userId", "==", user.uid)
      .get();

    const orders = ordersSnap.docs.map((doc) => {
      const order = doc.data() as PrakridaMerchOrderDocument;

      return {
        id: doc.id,
        item: order.item,
        paymentStatus: order.paymentStatus,
        paymentUrl: order.paymentUrl,
      };
    });

    reply.code(200);
    return { success: true, orders };
  });

  fastify.get("/prakrida/merch/order/:id", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const params = request.params as { id?: string };
    const id = (params?.id || "").trim();

    if (!id) {
      reply.code(400);
      return { error: true, message: "Missing order id" };
    }

    const orderRef = db.collection(PRAKRIDA_MERCH_COLLECTION).doc(id);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      reply.code(404);
      return { error: true, message: "Order not found" };
    }

    const order = orderSnap.data() as PrakridaMerchOrderDocument;

    if (order.userId !== user.uid) {
      reply.code(403);
      return { error: true, message: "Forbidden" };
    }

    if (order.paymentStatus === PaymentStatus.Confirmed) {
      reply.code(200);
      return {
        success: true,
        item: order.item,
        orderId: id,
        status: PaymentStatus.Confirmed,
        paymentUrl: order.paymentUrl,
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(id);
    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

    if (tiqrData.status && tiqrData.status !== order.paymentStatus) {
      await orderRef.update({
        paymentStatus: tiqrData.status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    reply.code(200);
    return {
      success: true,
      orderId: id,
      status: tiqrData.status,
      paymentUrl: order.paymentUrl,
      item: order.item,
      checksum:
        tiqrData.status === PaymentStatus.Confirmed ? tiqrData.checksum : null,
    };
  });
};

const PrakridaMerchItemPayload = z.object({
  type: z.enum(["single", "combo_two", "combo_three"]),
  quantity: z.number().int().min(1).max(3), // Zod enforces max 3
  size: z.string().min(1),
  tShirtSize: z.string().min(1).optional(),
});

const PrakridaMerchOrderPayload = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  college: z.string().min(1),
  item: PrakridaMerchItemPayload,
});

interface PrakridaMerchOrderDocument extends Record<string, any> {
  userId: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  item: { type: string; quantity: number; size?: string; tShirtSize?: string };
  tiqrBookingUid: string;
  paymentStatus: PaymentStatus | string;
  paymentUrl: string;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
}

export default PrakridaMerch;