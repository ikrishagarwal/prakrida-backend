import { FastifyPluginAsync } from "fastify";
import * as z from "zod";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import { PaymentBaseUrl, PaymentStatus, Tickets } from "../constants";
import TiQR, { FetchBookingResponse, BookingResponse } from "../lib/tiqr";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";

const alumni: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.addHook("onRequest", async (request, reply) => {
    const user = await validateAuthToken(request).catch(() => null);

    if (!user) {
      return await reply.code(401).send({
        error: true,
        message: "Unauthorized",
      });
    }

    request.setDecorator("user", user);
  });

  fastify.post("/alumni/register", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");
    const parsedBody = AlumniBodyData.safeParse(request.body);

    if (!parsedBody.success) {
      reply.status(400);
      return {
        error: "Invalid request body",
        details: z.prettifyError(parsedBody.error),
      };
    }

    const { name, phone, yearOfPassing, size } = parsedBody.data;

    const existingSnapshot = await db.collection("alumni").doc(user.uid).get();

    if (existingSnapshot.exists) {
      const doc = existingSnapshot.data()!;
      switch (doc.paymentStatus) {
        case PaymentStatus.Confirmed:
          reply.status(200);
          return {
            status: PaymentStatus.Confirmed,
            message: "Already registered successfully",
          };

        case PaymentStatus.PendingPayment:
          // case PaymentStatus.Failed:
          const paymentUrl = doc.paymentUrl;
          if (paymentUrl) {
            reply.status(200);
            return {
              status: PaymentStatus.PendingPayment,
              paymentUrl: paymentUrl,
            };
          } else {
            const tiqrResponse = await TiQR.fetchBooking(doc.tiqrBookingUid);
            const tiqrData =
              (await tiqrResponse.json()) as FetchBookingResponse;
            const paymentId = tiqrData.payment?.payment_id;

            if (!paymentId) {
              doc.ref.delete();
              break;
            }

            reply.status(200);
            return {
              status: PaymentStatus.PendingPayment,
              paymentUrl: PaymentBaseUrl + paymentId,
            };
          }

        default:
          doc.ref.delete();
          break;
      }
    }

    let finalPhone = phone.replace(/ /g, "");
    if (!finalPhone.startsWith("+")) {
      if (finalPhone.length === 10) {
        finalPhone = "+91" + finalPhone;
      } else if (finalPhone.length === 12 && finalPhone.startsWith("91")) {
        finalPhone = "+" + finalPhone;
      }
    }

    const alumniData = {
      firebaseUid: user.uid,
      fullName: name,
      email: user.email,
      phone: finalPhone,
      yearOfPassing,
      tShirtSize: size || "",
      paymentStatus: PaymentStatus.PendingPayment,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const [firstName, ...lastName] = name.trim().split(" ");

    const tiqrResponse = await TiQR.createBooking({
      first_name: firstName,
      last_name: lastName.join(" "),
      email: user.email!,
      phone_number: finalPhone,
      ticket: Tickets.Alumni,
      meta_data: {
        alumniId: user.uid,
      },
    });
    const tiqrData = (await tiqrResponse.json()) as BookingResponse;

    if (!tiqrData?.payment?.url_to_redirect)
      throw new Error("Failed to obtain payment URL from TiQR");

    await db
      .collection("alumni")
      .doc(user.uid)
      .set(
        {
          ...alumniData,
          tiqrBookingUid: tiqrData.booking.uid,
          paymentUrl: tiqrData.payment.url_to_redirect,
        },
        {
          merge: true,
        },
      );

    reply.status(200);
    return {
      status: PaymentStatus.PendingPayment,
      paymentUrl: tiqrData.payment.url_to_redirect,
    };
  });

  fastify.get("/alumni/status", async function (request, reply) {
    const user = request.getDecorator<DecodedIdToken>("user");

    const snapshot = await db.collection("alumni").doc(user.uid).get();

    if (!snapshot.exists) {
      reply.status(404);
      return { status: "unregistered" };
    }

    const docRef = snapshot.ref;
    const doc = snapshot.data()!;

    if (doc.paymentStatus === PaymentStatus.Confirmed) {
      reply.status(200);
      return {
        status: PaymentStatus.Confirmed,
        paymentUrl: doc.paymentUrl,
        details: {
          name: doc.fullName,
          merchName: doc.merchName,
          size: doc.tShirtSize,
        },
      };
    }

    const tiqrResponse = await TiQR.fetchBooking(doc.tiqrBookingUid);
    const tiqrData = (await tiqrResponse.json()) as FetchBookingResponse;

    const currentStatus = tiqrData.status;

    if (currentStatus && currentStatus != doc.paymentStatus) {
      docRef.update({
        paymentStatus: currentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      status: currentStatus,
      paymentUrl: PaymentBaseUrl + tiqrData.payment.payment_id,
      details: {
        name: doc.fullName,
        merchName: doc.merchName,
        size: doc.tShirtSize,
      },
    };
  });
};

const AlumniBodyData = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  yearOfPassing: z.coerce.number().min(1950).max(2026),
  size: z.string().min(1),
  merchName: z.string().optional().nullable(),
});

export default alumni;
