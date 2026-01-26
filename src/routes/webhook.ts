import { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { TiQR, BookingResponse } from "../lib/tiqr";
import { EventMappings, EventTicketIds, Tickets } from "../constants";
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
      case Tickets.Accommodation:
        const ref = db
          .collection(collectionName)
          .where("tiqrBookingUid", "==", body.booking_uid);
        const snap = await ref.get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            paymentStatus: body.booking_status,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        reply.status(204).send();
        return;
    }

    if (EventTicketIds.includes(ticketId)) {
      const eventId = Object.entries(EventMappings).find(
        ([_, value]) => Number(value) === ticketId,
      )?.[0];

      if (!eventId) {
        fastify.log.error("Failed to find event ID for ticket ID: " + ticketId);
        return reply.status(500).send();
      }

      const ref = await db
        .collection("events_registrations")
        .where("events." + eventId + ".tiqrBookingUid", "==", body.booking_uid)
        .get();

      if (!ref.empty) {
        const doc = ref.docs[0];
        await doc.ref.update({
          ["events." + eventId + ".status"]: body.booking_status,
          ["events." + eventId + ".updatedAt"]: FieldValue.serverTimestamp(),
        });
      }
    }

    reply.status(204).send();
  });
};

interface WebhookPayload {
  booking_uid: string;
  booking_status: string;
}

export default Webhook;
