import { FastifyPluginAsync } from "fastify";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import z from "zod";
import { PaymentStatus, PRAKRIDA_MERCH_COLLECTION, Tickets } from "../constants";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import TiQR, { BookingResponse, BulkBookingResponse, FetchBookingResponse } from "../lib/tiqr";

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

  fastify.post("/merch/order", async function (request, reply) {
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
    if (body.data.items.length > 3) {
      reply.code(400);
      return {
        error: true,
        message: "You cannot order more than 3 items",
      };
    }

    // Determine ticket ID based on number of items
    let ticketId: number;
    const itemCount = body.data.items.length;

    if (itemCount === 1) {
      ticketId = Tickets.MerchSingle;
    } else if (itemCount === 2) {
      ticketId = Tickets.MerchComboTwo;
    } else if (itemCount === 3) {
      ticketId = Tickets.MerchComboThree;
    } else {
      // This should never happen due to initial validation, but keeping for safety
      reply.code(400);
      return {
        error: true,
        message: "Invalid number of items",
      };
    }

    const [firstName, ...restName] = body.data.name.trim().split(/\s+/);

    const tiqrResponse = await TiQR.createBooking({
      first_name: firstName,
      last_name: restName.join(" "),
      phone_number: body.data.phone,
      email: user.email!,
      ticket: ticketId,
      quantity: 1,
      meta_data: {
        merch: {
          items: body.data.items,
        },
      },
    });

    const tiqrData = (await tiqrResponse.json()) as BookingResponse | BulkBookingResponse;
    fastify.log.info(tiqrData);

    // Handle both single and bulk booking response types
    let orderId: string;
    let paymentStatus: string;
    let paymentUrl: string;

    // Check if this is a bulk response (for combo orders with 2+ items)
    if ('booking' in tiqrData && 'uid' in tiqrData.booking && 'child_bookings' in tiqrData.booking) {
      // Bulk booking response
      orderId = tiqrData.booking.uid;
      paymentStatus = tiqrData.booking.status;
      paymentUrl = tiqrData.payment.url_to_redirect || "";
    } else if ('booking' in tiqrData && 'uid' in tiqrData.booking) {
      // Single booking response
      orderId = tiqrData.booking.uid;
      paymentStatus = tiqrData.booking.status;
      paymentUrl = tiqrData.payment.url_to_redirect || "";
    } else {
      reply.code(500);
      return {
        error: true,
        message: "Unexpected TiQR response format",
      };
    }

    const orderDoc: PrakridaMerchOrderDocument = {
      userId: user.uid,
      email: user.email || "",
      name: body.data.name,
      phone: body.data.phone,
      college: body.data.college,
      items: body.data.items,
      tiqrBookingUid: orderId,
      paymentStatus: paymentStatus as PaymentStatus,
      paymentUrl: paymentUrl,
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

  fastify.get("/merch/orders", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const ordersSnap = await db
      .collection(PRAKRIDA_MERCH_COLLECTION)
      .where("userId", "==", user.uid)
      .get();

    const orders = ordersSnap.docs.map((doc) => {
      const order = doc.data() as PrakridaMerchOrderDocument;

      return {
        id: doc.id,
        items: order.items,
        paymentStatus: order.paymentStatus,
        paymentUrl: order.paymentUrl,
      };
    });

    reply.code(200);
    return { success: true, orders };
  });

  fastify.get("/merch/order/:id", async function (request, reply) {
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
        items: order.items,
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
      items: order.items,
      checksum:
        tiqrData.status === PaymentStatus.Confirmed ? tiqrData.checksum : null,
    };
  });
};

const PrakridaMerchItemPayload = z.object({
  color: z.enum(["white", "black", "beige"]),
  size: z.string().min(1),
});

const PrakridaMerchOrderPayload = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  college: z.string().min(1),
  items: z.array(PrakridaMerchItemPayload),
});

interface PrakridaMerchOrderDocument extends Record<string, any> {
  userId: string;
  name: string;
  email: string;
  phone: string;
  college: string;
  items: Array<{ color: string; size: string }>;
  tiqrBookingUid: string;
  paymentStatus: PaymentStatus | string;
  paymentUrl: string;
  createdAt: FieldValue | Timestamp;
  updatedAt: FieldValue | Timestamp;
}

export default PrakridaMerch;