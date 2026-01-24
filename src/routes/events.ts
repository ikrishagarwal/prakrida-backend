import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";
import { Tickets } from "../constants";
import { EventMappings } from "../constants";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

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
    const { ticketId } = request.body as { ticketId: number };

    const collectionName = EventMappings[ticketId as Tickets];
    if (!collectionName) {
      return reply.code(400).send({ error: "Invalid ticketId" });
    }

    const bookingRef = db
      .collection(collectionName)
      .doc(user.uid);

    const existing = await bookingRef.get();
    if (existing.exists) {
      return reply.code(409).send({
        error: "Already registered for this event",
      });
    }

    await bookingRef.set({
      userId: user.uid,
      ticketId,
      status: "pending",
      createdAt: Date.now(),
    });

    return {
      message: "Booking initiated",
      ticketId,
      event: collectionName,
      status: "pending",
    };
  });

  fastify.get("/events/status/:eventId", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const { eventId } = request.params as { eventId: string };

    const ticketId = Number(eventId);
    const collectionName = EventMappings[ticketId as Tickets];

    if (!collectionName) {
      return reply.code(400).send({ error: "Invalid eventId" });
    }

    const bookingRef = db
      .collection(collectionName)
      .doc(user.uid);

    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return {
        ticketId,
        status: "not_registered",
      };
    }

    return {
      ticketId,
      ...bookingSnap.data(),
    };
  });

  fastify.get("/events/registered", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    const results: any[] = [];

    // Loop over ALL mapped events
    for (const [ticketIdStr, collectionName] of Object.entries(EventMappings)) {
      const ticketId = Number(ticketIdStr);

      const doc = await db
        .collection(collectionName)
        .doc(user.uid)
        .get();

      if (doc.exists) {
        results.push({
          ticketId,
          event: collectionName,
          ...doc.data(),
        });
      }
    }

    return {
      count: results.length,
      events: results,
    };
  });
};

export default Event;
