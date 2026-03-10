import "dotenv/config";
import { initializeFirebase, db } from "./lib/firebase";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { PaymentStatus } from "./constants";

const FireBaseUIDToExclude = [
  "crYjzSudspf6OXKmXiw2w77hKsz1",
  "v7WfDeMamFTSAyQ9RuPgi0Lks7R2",
];

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
  16: "Lawn-Tennis Men's Singles",
  17: "Lawn-Tennis Women's Singles",
  118: "Lawn-Tennis Men's Group",
  119: "Lawn-Tennis Women's Group",
  120: "Lawn-Tennis Men's Doubles",
  121: "Lawn-Tennis Women's Doubles",
  18: "Table Tennis Team Men's",
  19: "Table Tennis Team Women's",
  20: "Table Tennis Solo Men's",
  21: "Table Tennis Solo Women's",
  22: "Table Tennis Mixed Doubles",
  23: "Carrom Men's",
  24: "Carrom Women's",
  25: "Carrom Mixed Doubles",
};

// Simple CSV generator function
function convertToCSV(data: any[]): string {
  if (data.length === 0) return "";

  // Detect if this is accommodation data based on first row
  const isAccommodation =
    data.length > 0 &&
    data[0].eventName === "Accommodation" &&
    data[0].isAccommodationRow;

  // Define main columns order based on data type
  let mainColumns: string[];
  if (isAccommodation) {
    mainColumns = [
      "eventName",
      "teamName",
      "college",
      "status",
      "name",
      "email",
      "phone",
      "gender",
    ];
  } else {
    mainColumns = [
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
  }

  // Add member columns (member1_name, member1_role, member1_email, member1_phone, etc.) for events only
  let maxMembers = 0;
  if (!isAccommodation) {
    data.forEach((row) => {
      if (row.sortedMembers) {
        maxMembers = Math.max(maxMembers, row.sortedMembers.length);
      }
    });
  }

  const headers = [...mainColumns];
  if (!isAccommodation) {
    for (let i = 1; i <= maxMembers; i++) {
      headers.push(`member${i}_name`);
      headers.push(`member${i}_role`);
      headers.push(`member${i}_email`);
      headers.push(`member${i}_phone`);
    }
  }

  // Escape CSV values
  const escapeCSV = (val: any, key: string = ""): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);

    // Force phone as text with leading single quote to prevent Excel scientific notation
    // Apply to all phone columns (main + member phones)
    if (key === "phone" || key.includes("phone")) {
      // Hack: prepend single quote without outer quotes for CSV format
      // This forces Excel to treat the entire value as text
      return `'${str}`;
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
    // Add member columns (for events only)
    if (!isAccommodation && row.sortedMembers) {
      row.sortedMembers.forEach((member: any, index: number) => {
        rowValues[`member${index + 1}_name`] = member.name || "";
        rowValues[`member${index + 1}_role`] = member.role || "";
        rowValues[`member${index + 1}_email`] = member.email || "";
        rowValues[`member${index + 1}_phone`] = member.phone || "";
      });
    }
    return headers
      .map((header) => escapeCSV(rowValues[header], header))
      .join(",");
  });

  return [headerRow, ...dataRows].join("\n");
}

interface ExportTask {
  type: "events" | "accommodation";
  statusFilter?: string;
  specificEventId?: string;
  filename: string;
}

async function main() {
  initializeFirebase();
  const rl = readline.createInterface({ input, output });

  console.log("=========================================");
  console.log("       Prakrida Data Exporter CLI        ");
  console.log("=========================================\n");
  console.log("1. Pending Payment Registrations");
  console.log("2. Confirmed Registrations");
  console.log("3. All Registrations");
  console.log("4. Specific Event ID");
  console.log("5. Confirmed Accommodation");
  console.log("6. Pending Accommodation\n");
  console.log(
    "Note: You can select multiple options by separating them with commas (e.g., 1,2,5).\n",
  );

  const answer = await rl.question("Choose options: ");
  const choices = answer
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (choices.length === 0) {
    console.log("No valid choices provided. Exiting.");
    process.exit(1);
  }

  const exportTasks: ExportTask[] = [];

  for (const choice of choices) {
    if (choice === "1") {
      exportTasks.push({
        type: "events",
        statusFilter: PaymentStatus.PendingPayment,
        filename: "pending_events.csv",
      });
    } else if (choice === "2") {
      exportTasks.push({
        type: "events",
        statusFilter: PaymentStatus.Confirmed,
        filename: "confirmed_events.csv",
      });
    } else if (choice === "3") {
      exportTasks.push({
        type: "events",
        statusFilter: undefined,
        filename: "all_events.csv",
      });
    } else if (choice === "4") {
      const specificEventId = await rl.question(
        "\nEnter Event ID for option 4: ",
      );
      const statusChoice = await rl.question(
        `Filter by status for Event ${specificEventId}? (1: Pending, 2: Confirmed, 3: All): `,
      );
      let statusFilter;
      let filename;
      if (statusChoice === "1") {
        statusFilter = PaymentStatus.PendingPayment;
        filename = `event_${specificEventId}_pending.csv`;
      } else if (statusChoice === "2") {
        statusFilter = PaymentStatus.Confirmed;
        filename = `event_${specificEventId}_confirmed.csv`;
      } else {
        statusFilter = undefined;
        filename = `event_${specificEventId}_all.csv`;
      }
      exportTasks.push({
        type: "events",
        specificEventId,
        statusFilter,
        filename,
      });
    } else if (choice === "5") {
      exportTasks.push({
        type: "accommodation",
        statusFilter: PaymentStatus.Confirmed,
        filename: "accommodation_confirmed.csv",
      });
    } else if (choice === "6") {
      exportTasks.push({
        type: "accommodation",
        statusFilter: PaymentStatus.PendingPayment,
        filename: "accommodation_pending.csv",
      });
    } else {
      console.log(`Warning: Invalid choice '${choice}', skipping.`);
    }
  }

  if (exportTasks.length === 0) {
    console.log("No tasks to run. Exiting.");
    process.exit(1);
  }

  console.log("\nFetching data from Firestore (this may take a moment)...");

  try {
    const eventsSnapshot = exportTasks.some((t) => t.type === "events")
      ? await db.collection("events_registrations").get()
      : null;
    const accomSnapshot = exportTasks.some((t) => t.type === "accommodation")
      ? await db.collection("accommodation").get()
      : null;

    for (const task of exportTasks) {
      console.log(`\nProcessing task: ${task.filename}...`);
      const registrations: any[] = [];

      if (task.type === "events" && eventsSnapshot) {
        eventsSnapshot.docs.forEach((doc) => {
          if (FireBaseUIDToExclude.includes(doc.id)) {
            return;
          }

          const userData = doc.data();
          const events = userData.events || {};

          Object.entries(events).forEach(
            ([eventId, eventData]: [string, any]) => {
              // Apply filters
              if (task.specificEventId && eventId !== task.specificEventId) {
                return;
              }
              if (task.statusFilter && eventData.status !== task.statusFilter) {
                return;
              }

              // Sort members: Captain first, then Vice-Captain, then others
              const sortedMembers = (eventData.members || []).sort(
                (a: any, b: any) => {
                  const roleOrder = { Captain: 0, "Vice-Captain": 1 };
                  const aOrder =
                    roleOrder[a.role as keyof typeof roleOrder] ??
                    Number.MAX_SAFE_INTEGER;
                  const bOrder =
                    roleOrder[b.role as keyof typeof roleOrder] ??
                    Number.MAX_SAFE_INTEGER;
                  return aOrder - bOrder;
                },
              );

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

              registrations.push(registration);
            },
          );
        });
      } else if (task.type === "accommodation" && accomSnapshot) {
        accomSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          // Only check ownerUID for exclusion
          if (FireBaseUIDToExclude.includes(data.ownerUID)) {
            return;
          }

          if (task.statusFilter && data.paymentStatus !== task.statusFilter) {
            return;
          }

          // Create one row per member
          const members = data.members || [];
          members.forEach((member: any) => {
            const registration = {
              eventName: "Accommodation",
              teamName: doc.id, // Group ID
              college: data.college || "",
              status: data.paymentStatus || "",
              name: member.name || "",
              email: member.email || "",
              phone: member.phone || "",
              gender: member.gender || "",
              isAccommodationRow: true,
            };
            registrations.push(registration);
          });
        });
      }

      // Sort the final array by eventName and role
      registrations.sort((a, b) => {
        if (a.eventName !== b.eventName)
          return a.eventName.localeCompare(b.eventName);

        const roleOrder = { Captain: 0, "Vice-Captain": 1 };
        const aOrder =
          roleOrder[a.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;
        const bOrder =
          roleOrder[b.role as keyof typeof roleOrder] ??
          Number.MAX_SAFE_INTEGER;

        return aOrder - bOrder;
      });

      if (registrations.length === 0) {
        console.log(
          `No registrations found matching the criteria for ${task.filename}.`,
        );
      } else {
        const csv = convertToCSV(registrations);
        const outPath = path.join(process.cwd(), task.filename);
        fs.writeFileSync(outPath, csv, "utf-8");
        console.log(
          `Successfully exported ${registrations.length} registrations to ${outPath}`,
        );
      }
    }
  } catch (error) {
    console.error("Error exporting data:", error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
