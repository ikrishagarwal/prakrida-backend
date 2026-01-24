import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { TiQR, BookingResponse } from "../lib/tiqr";
import { EventMappings, Tickets } from "../constants";
import { db } from "../lib/firebase";
import { FieldValue } from "firebase-admin/firestore";

const Webhook: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook("onRequest", async (request, reply) => {
    const tokenHeader = request.headers["x-webhook-token"];
    const token =
      (Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader) || "";
    const webhookToken = process.env.WEBHOOK_TOKEN;

    if (!webhookToken) {
      fastify.log.error("Webhook secret not configured");
      return reply //
        .code(500)
        .send({
          error: true,
          message: "Internal Server Error",
        });
    }

    if (token.length !== webhookToken.length) {
      fastify.log.warn("Unauthorized webhook access attempt");
      return reply //
        .code(401)
        .send({
          error: true,
          message: "Unauthorized",
        });
    }

    if (
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(webhookToken))
    ) {
      fastify.log.warn("Unauthorized webhook access attempt");
      return reply //
        .code(401)
        .send({
          error: true,
          message: "Unauthorized",
        });
    }
  });

  fastify.post("/webhook", async function (request, reply) {
    const body = request.body as WebhookPayload;

    const safeLogBody: Record<string, any> = {};
    const allowedFields = [
      "booking_status",
      "booking_uid",
      "email",
      "event_name",
      "first_name",
      "last_name",
      "name",
      "phone_number",
      "quantity",
      "ticket_type",
      "ticket_price",
    ];

    for (const key of allowedFields) {
      if (key in body) {
        // @ts-ignore
        safeLogBody[key] = body[key];
      }
    }

    fastify.log.info({
      msg: "Received webhook",
      payload: safeLogBody,
    });

    const tiqrResponse = await TiQR.fetchBooking(body.booking_uid);
    if (!tiqrResponse.ok) {
      fastify.log.error("Failed to fetch booking data from TiQR");
      return reply.code(500).send();
    }

    const tiqrData = (await tiqrResponse.json()) as BookingResponse;
    const ticketId = Number(tiqrData.ticket.id);
    const collectionName = EventMappings[ticketId];

    switch (ticketId) {
      case Tickets.Test:
      case Tickets.Accommodation:
        const ref = db.collection(collectionName).doc(body.booking_uid);
        const snap = await ref.get();
        if (snap.exists) {
          await ref.update({
            paymentStatus: body.booking_status,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        break;
    }

    reply.status(204).send();
  });
};

interface WebhookPayload {
  booking_uid: string;
  booking_status: string;
}

export default Webhook;
