import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { DecodedIdToken } from "firebase-admin/auth";

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
    return {};
  });

  fastify.get("/events/status/:eventId", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    return {};
  });

  fastify.get("/events/registered", async (request, reply) => {
    const user = request.getDecorator<DecodedIdToken>("user");
    return {};
  });
};

export default Event;
