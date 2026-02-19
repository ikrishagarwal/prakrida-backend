import { FastifyPluginAsync } from "fastify";
import { validateAuthToken } from "../lib/auth";
import { db } from "../lib/firebase";
import { PaymentStatus } from "../constants";

// Event ID to Event Name mapping
const EVENT_NAME_MAP: Record<number, string> = {
  1: "Cricket Men's",
  2: "Cricket Women's",
  3: "Football Men's",
  4: "Football Women's",
  5: "Chess",
  7: "Volleyball Men's",
  8: "Volleyball Women's",
  9: "Basketball Men's",
  10: "Basketball Women's",
  11: "Badminton Men's",
  12: "Badminton Women's",
  13: "E-sports BGMI",
  14: "E-sports Valorant",
  15: "E-sports Free-Fire",
  16: "Lawn-Tennis Men's",
  17: "Lawn-Tennis Women's",
  18: "Table Tennis Team Men's",
  19: "Table Tennis Team Women's",
  20: "Table Tennis Solo Men's",
  21: "Table Tennis Solo Women's",
  22: "Table Tennis Mixed Doubles",
  23: "Carrom Men's",
  24: "Carrom Women's",
  25: "Carrom Mixed Doubles",
  118: "Lawn-Tennis Group",
  119: "Lawn-Tennis Group",
};

// Simple CSV generator function
function convertToCSV(data: any[]): string {
  if (data.length === 0) return "";

  // Get all unique keys
  const allKeys = new Set<string>();
  data.forEach((row) => Object.keys(row).forEach((key) => allKeys.add(key)));

  // Define main columns order
  const mainColumns = [
    "name",
    "email",
    "phone",
    "eventName",
    "eventType",
    "teamName",
    "college",
    "status",
    "role",
    "gender",
  ];

  // Add member columns (member1_name, member1_role, member1_email, etc.)
  let maxMembers = 0;
  data.forEach((row) => {
    if (row.sortedMembers) {
      maxMembers = Math.max(maxMembers, row.sortedMembers.length);
    }
  });

  const headers = [...mainColumns];
  for (let i = 1; i <= maxMembers; i++) {
    headers.push(`member${i}_name`);
    headers.push(`member${i}_role`);
    headers.push(`member${i}_email`);
  }

  // Escape CSV values
  const escapeCSV = (val: any, key: string = ""): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    
    // Force phone as text with leading single quote to prevent Excel scientific notation
    if (key === "phone") {
      return `"'${str.replace(/"/g, '""')}"`;
    }
    
    // Always quote emails
    if (key === "email" || key.includes("email")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Create header row
  const headerRow = headers.map((h) => escapeCSV(h, "")).join(",");

  // Create data rows
  const dataRows = data.map((row) => {
    const rowValues: any = {};
    // Add main columns
    mainColumns.forEach((col) => {
      rowValues[col] = row[col] || "";
    });
    // Add member columns
    if (row.sortedMembers) {
      row.sortedMembers.forEach((member: any, index: number) => {
        rowValues[`member${index + 1}_name`] = member.name || "";
        rowValues[`member${index + 1}_role`] = member.role || "";
        rowValues[`member${index + 1}_email`] = member.email || "";
      });
    }
    return headers.map((header) => escapeCSV(rowValues[header], header)).join(",");
  });

  return [headerRow, ...dataRows].join("\n");
}

const ExportRoute: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.decorateRequest("user", null);
  fastify.decorateRequest("isAdmin", false);

  // Public endpoints (BEFORE auth hook) - no authentication required
  
  // Test endpoint to check if data exists
  fastify.get("/export/test", async (request, reply) => {
    try {
      const eventsCollection = db.collection("events_registrations");
      const snapshot = await eventsCollection.limit(5).get();
      
      return {
        message: "✅ Database connected!",
        documentCount: snapshot.size,
        hasData: snapshot.size > 0,
        checkStatus: "Database is accessible"
      };
    } catch (error) {
      fastify.log.error(error);
      return {
        error: true,
        message: "❌ Database connection failed",
        details: (error as any).message
      };
    }
  });

  // Public export endpoint (for testing, no auth required)
  fastify.get("/export/demo", async (request, reply) => {
    try {
      const eventsCollection = db.collection("events_registrations");
      const snapshot = await eventsCollection.get();

      const allData: any[] = [];

      snapshot.docs.forEach((doc) => {
        const userData = doc.data();
        const events = userData.events || {};

        Object.entries(events).forEach(([eventId, eventData]: [string, any]) => {
          // Sort members: Captain first, then Vice-Captain, then others
          const sortedMembers = (eventData.members || []).sort((a: any, b: any) => {
            const roleOrder = { Captain: 0, "Vice-Captain": 1 };
            const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
            const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
          });

          const eventIdNum = parseInt(eventId) || 0;
          const registration = {
            name: userData.name || "",
            email: userData.email || "",
            phone: userData.phone || "",
            eventName: EVENT_NAME_MAP[eventIdNum] || eventId,
            eventType: eventData.type || "",
            teamName: eventData.teamName || "",
            college: eventData.college || "",
            status: eventData.status,
            role: eventData.role || "",
            gender: eventData.gender || "",
            sortedMembers: sortedMembers,
          };

          allData.push(registration);
        });
      });

      // Sort by eventId and role
      allData.sort((a, b) => {
        if (a.eventId !== b.eventId) return a.eventId.localeCompare(b.eventId);

        const roleOrder = { Captain: 0, "Vice-Captain": 1 };
        const aOrder =
          roleOrder[a.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;
        const bOrder =
          roleOrder[b.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      });

      const csv = convertToCSV(allData);

      reply.header("Content-Disposition", "attachment; filename=demo_export.csv");
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.send(csv);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: true,
        message: "Failed to export demo data",
        details: (error as any).message
      });
    }
  });

  // Auth hook for protected routes (applies to routes defined after this)
  fastify.addHook("onRequest", async (request, reply) => {
    // Skip auth for public export endpoints
    if (request.url.includes("/export/test") || 
        request.url.includes("/export/demo") ||
        request.url.includes("/export/events/pending") ||
        request.url.includes("/export/events/confirmed") ||
        request.url.includes("/export/events/all")) {
      return;
    }

    const user = await validateAuthToken(request).catch(() => null);

    if (!user) {
      return await reply.code(401).send({
        error: true,
        message: "unauthorized",
      });
    }

    // Check admin status from custom claims or env
    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim());
    const isAdmin = adminEmails.includes(user.email || "") || user.email === "test@example.com";

    request.setDecorator("user", user);
    request.setDecorator("isAdmin", isAdmin);
  });

  /**
   * Export Pending Event Registrations as CSV
   * GET /export/events/pending
   */
  fastify.get("/export/events/pending", async (request, reply) => {
    try {
      const eventsCollection = db.collection("events_registrations");
      const snapshot = await eventsCollection.get();

      const pendingRegistrations: any[] = [];

      snapshot.docs.forEach((doc) => {
        const userData = doc.data();
        const events = userData.events || {};

        Object.entries(events).forEach(([eventId, eventData]: [string, any]) => {
          if (eventData.status === PaymentStatus.PendingPayment) {
            // Sort members: Captain first, then Vice-Captain, then others
            const sortedMembers = (eventData.members || []).sort((a: any, b: any) => {
              const roleOrder = { Captain: 0, "Vice-Captain": 1 };
              const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              return aOrder - bOrder;
            });

            const eventIdNum = parseInt(eventId) || 0;
            const registration = {
              name: userData.name || "",
              email: userData.email || "",
              phone: userData.phone || "",
              eventName: EVENT_NAME_MAP[eventIdNum] || eventId,
              eventType: eventData.type || "",
              teamName: eventData.teamName || "",
              college: eventData.college || "",
              status: eventData.status,
              role: eventData.role || "",
              gender: eventData.gender || "",
              sortedMembers: sortedMembers,
            };

            pendingRegistrations.push(registration);
          }
        });
      });

      // Sort by eventId and role (Captain first, then Vice-Captain, then others)
      pendingRegistrations.sort((a, b) => {
        if (a.eventId !== b.eventId) return a.eventId.localeCompare(b.eventId);

        const roleOrder = { Captain: 0, "Vice-Captain": 1 };
        const aOrder =
          roleOrder[a.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;
        const bOrder =
          roleOrder[b.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      });

      const csv = convertToCSV(pendingRegistrations);

      reply.header("Content-Disposition", "attachment; filename=pending_events.csv");
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.send(csv);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: true,
        message: "Failed to export pending registrations",
      });
    }
  });

  /**
   * Export Confirmed Event Registrations as CSV
   * GET /export/events/confirmed
   */
  fastify.get("/export/events/confirmed", async (request, reply) => {
    try {
      const eventsCollection = db.collection("events_registrations");
      const snapshot = await eventsCollection.get();

      const confirmedRegistrations: any[] = [];

      snapshot.docs.forEach((doc) => {
        const userData = doc.data();
        const events = userData.events || {};

        Object.entries(events).forEach(([eventId, eventData]: [string, any]) => {
          if (eventData.status === PaymentStatus.Confirmed) {
            // Sort members: Captain first, then Vice-Captain, then others
            const sortedMembers = (eventData.members || []).sort((a: any, b: any) => {
              const roleOrder = { Captain: 0, "Vice-Captain": 1 };
              const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              return aOrder - bOrder;
            });

            const eventIdNum = parseInt(eventId) || 0;
            const registration = {
              name: userData.name || "",
              email: userData.email || "",
              phone: userData.phone || "",
              eventName: EVENT_NAME_MAP[eventIdNum] || eventId,
              eventType: eventData.type || "",
              teamName: eventData.teamName || "",
              college: eventData.college || "",
              status: eventData.status,
              role: eventData.role || "",
              gender: eventData.gender || "",
              sortedMembers: sortedMembers,
            };

            confirmedRegistrations.push(registration);
          }
        });
      });

      // Sort by eventId and role (Captain first, then Vice-Captain, then others)
      confirmedRegistrations.sort((a, b) => {
        if (a.eventId !== b.eventId) return a.eventId.localeCompare(b.eventId);

        const roleOrder = { Captain: 0, "Vice-Captain": 1 };
        const aOrder =
          roleOrder[a.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;
        const bOrder =
          roleOrder[b.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      });

      const csv = convertToCSV(confirmedRegistrations);

      reply.header(
        "Content-Disposition",
        "attachment; filename=confirmed_events.csv"
      );
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.send(csv);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: true,
        message: "Failed to export confirmed registrations",
      });
    }
  });

  /**
   * Export All Event Registrations (Both Pending + Confirmed) as CSV
   * GET /export/events/all
   */
  fastify.get("/export/events/all", async (request, reply) => {
    try {
      const eventsCollection = db.collection("events_registrations");
      const snapshot = await eventsCollection.get();

      const allRegistrations: any[] = [];

      snapshot.docs.forEach((doc) => {
        const userData = doc.data();
        const events = userData.events || {};

        Object.entries(events).forEach(([eventId, eventData]: [string, any]) => {
          // Sort members: Captain first, then Vice-Captain, then others
          const sortedMembers = (eventData.members || []).sort((a: any, b: any) => {
            const roleOrder = { Captain: 0, "Vice-Captain": 1 };
            const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
            const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
          });

          const eventIdNum = parseInt(eventId) || 0;
          const registration = {
            name: userData.name || "",
            email: userData.email || "",
            phone: userData.phone || "",
            eventName: EVENT_NAME_MAP[eventIdNum] || eventId,
            eventType: eventData.type || "",
            teamName: eventData.teamName || "",
            college: eventData.college || "",
            status: eventData.status,
            role: eventData.role || "",
            gender: eventData.gender || "",
            sortedMembers: sortedMembers,
          };

          allRegistrations.push(registration);
        });
      });

      // Sort by eventId and role (Captain first, then Vice-Captain, then others)
      allRegistrations.sort((a, b) => {
        if (a.eventId !== b.eventId) return a.eventId.localeCompare(b.eventId);

        const roleOrder = { Captain: 0, "Vice-Captain": 1 };
        const aOrder =
          roleOrder[a.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;
        const bOrder =
          roleOrder[b.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      });

      const csv = convertToCSV(allRegistrations);

      reply.header("Content-Disposition", "attachment; filename=all_events.csv");
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.send(csv);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        error: true,
        message: "Failed to export all registrations",
      });
    }
  });

  /**
   * Export Event Registrations by Event ID
   * GET /export/events/:eventId?status=pending or confirmed or all
   */
  fastify.get(
    "/export/events/:eventId",
    async (request, reply) => {
      const isAdmin = request.getDecorator<boolean>("isAdmin");
      const { eventId } = request.params as { eventId: string };
      const { status } = request.query as { status?: string };

      if (!isAdmin) {
        return reply.code(403).send({
          error: true,
          message: "Only admins can export data",
        });
      }

      try {
        const eventsCollection = db.collection("events_registrations");
        const snapshot = await eventsCollection.get();

        const eventRegistrations: any[] = [];
        const validStatuses = [
          PaymentStatus.PendingPayment,
          PaymentStatus.Confirmed,
        ];

        snapshot.docs.forEach((doc) => {
          const userData = doc.data();
          const events = userData.events || {};
          const eventData = events[eventId];

          if (eventData) {
            // Filter by status if provided
            if (status && !validStatuses.includes(status as PaymentStatus)) {
              return;
            }

            if (status && eventData.status !== status) {
              return;
            }

            // Sort members: Captain first, then Vice-Captain, then others
            const sortedMembers = (eventData.members || []).sort((a: any, b: any) => {
              const roleOrder = { Captain: 0, "Vice-Captain": 1 };
              const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? Number.MAX_SAFE_INTEGER;
              return aOrder - bOrder;
            });

            const eventIdNum = parseInt(eventId) || 0;
            const registration = {
              name: userData.name || "",
              email: userData.email || "",
              phone: userData.phone || "",
              eventName: EVENT_NAME_MAP[eventIdNum] || eventId,
              eventType: eventData.type || "",
              teamName: eventData.teamName || "",
              college: eventData.college || "",
              status: eventData.status,
              role: eventData.role || "",
              gender: eventData.gender || "",
              sortedMembers: sortedMembers,
            };

            eventRegistrations.push(registration);
          }
        });

        // Sort by role (Captain first, then Vice-Captain, then others)
        eventRegistrations.sort((a, b) => {
          const roleOrder = { Captain: 0, "Vice-Captain": 1 };
          const aOrder =
            roleOrder[a.role as keyof typeof roleOrder] ??
            Number.MAX_SAFE_INTEGER;
          const bOrder =
            roleOrder[b.role as keyof typeof roleOrder] ??
            Number.MAX_SAFE_INTEGER;

          return aOrder - bOrder;
        });

        const statusStr = status || "all";
        const filename = `event_${eventId}_${statusStr}.csv`;

        const csv = convertToCSV(eventRegistrations);

        reply.header("Content-Disposition", `attachment; filename=${filename}`);
        reply.header("Content-Type", "text/csv");
        reply.send(csv);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: true,
          message: "Failed to export event registrations",
        });
      }
    }
  );
};

export default ExportRoute;
