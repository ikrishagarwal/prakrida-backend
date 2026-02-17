import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { EventIds } from './constants';

// Map ticketId to readable event name
const ticketIdToName: Record<number, string> = {
  2611: "Volleyball Men's",
  2614: "Basketball Women's",
  2618: "Free Fire",
  2619: "Lawn Tennis",
  2610: "Lawn Tennis Group",
  2621: "Table Tennis Team Women's",
  2623: "Table Tennis Women Solo",
  2612: "Volleyball Women's",
  2615: "Badminton Men's",
  2622: "Table Tennis Solo Men",
  2613: "Basketball Men's",
  2616: "Badminton Women's",
  2617: "BGMI/Valorant",
  2620: "Table Tennis Team Men",
  2624: "Table Tennis Mixed Doubles",
  2605: "Cricket Men's",
  2606: "Cricket Women's",
  2607: "Football Men's",
  2608: "Football Women's",
  2609: "Chess",
  2625: "Carrom",
  2626: "Accommodation",
  2636: "Alumni"
};

const inputPath = path.resolve(__dirname, '../events_registrations.csv');
const outputConfirmedPath = path.resolve(__dirname, '../registration_confirmed.csv');
const outputPendingPath = path.resolve(__dirname, '../registration_payment_pending.csv');

interface RegistrationRow {
  id: string;
  email: string;
  name: string;
  phone: string;
  createdAt: string;
  events: string;
  college?: string;
}

const excludeUIDs = [
  'crYjzSudspf6OXKmXiw2w77hKsz1',
  'v7WfDeMamFTSAyQ9RuPgi0Lks7R2',
];


function flattenSingleEvent(eventKey: string, event: any) {
  const flat: any = {};
  
  // Map event_id to event name using EventIds and ticketIdToName
  if (eventKey) {
    const eventId = parseInt(eventKey);
    
    // First check if eventKey is directly a Tickets enum value (ticket ID)
    if (ticketIdToName[eventId]) {
      flat.event_name = ticketIdToName[eventId];
    } 
    // Otherwise, it's an EventIds key, so map through EventIds to get the ticket ID
    else if (EventIds[eventId]) {
      const ticketId = EventIds[eventId] as number;
      flat.event_name = ticketIdToName[ticketId] || String(ticketId);
    } 
    // Fallback if neither mapping works
    else {
      flat.event_name = String(eventId);
    }
  }

  flat.event_type = event?.type || '';
  flat.team_name = event?.teamName || '';
  flat.college = event?.college || '';
  flat.status = event?.status || '';
  flat.role = event?.role || '';
  flat.gender = event?.gender || '';

  // Flatten members: captain, vice captain, then others
  let members: any[] = Array.isArray(event?.members) ? [...event.members] : [];
  let ordered: any[] = [];

  const captainIdx = members.findIndex(m => (m.role || '').toLowerCase() === 'captain');
  if (captainIdx !== -1) ordered.push(members.splice(captainIdx, 1)[0]);

  const viceIdx = members.findIndex(m => (m.role || '').toLowerCase() === 'vice-captain');
  if (viceIdx !== -1) ordered.push(members.splice(viceIdx, 1)[0]);

  ordered = [...ordered, ...members];

  ordered.forEach((m: any, i: number) => {
    flat[`member${i + 1}_name`] = m?.name || '';
    flat[`member${i + 1}_email`] = m?.email || '';
    flat[`member${i + 1}_phone`] = m?.phone ? `'${m.phone}` : '';
    flat[`member${i + 1}_role`] = m?.role || '';
    flat[`member${i + 1}_gender`] = m?.gender || '';
  });

  return flat;
}

// Main Execution
const raw = fs.readFileSync(inputPath, 'utf8');
const records = parse(raw, { columns: true, skip_empty_lines: true }) as RegistrationRow[];

const confirmed: any[] = [];
const pending: any[] = [];

for (const row of records) {
  if (excludeUIDs.includes(row.id)) continue;

  let eventsObj: any = {};
  try {
    eventsObj = JSON.parse(row.events.replace(/''/g, '"').replace(/""/g, '"'));
  } catch {
    try { eventsObj = eval('(' + row.events + ')'); } catch { eventsObj = {}; }
  }

  // SOLUTION: Iterate over all event keys for this user
  for (const eventKey of Object.keys(eventsObj)) {
    const eventData = eventsObj[eventKey];
    const flat = flattenSingleEvent(eventKey, eventData);

    // Get the primary member (usually the first one) for name/email/phone fallback
    const primaryMember = (Array.isArray(eventData?.members) && eventData.members[0]) 
      ? eventData.members[0]
      : null;

    const base = {
      name: row.name || primaryMember?.name || '',
      email: row.email || primaryMember?.email || '',
      phone: row.phone ? `'${row.phone}` : (primaryMember?.phone ? `'${primaryMember.phone}` : ''),
      ...flat
    };

    if (flat.status === 'confirmed') {
      confirmed.push(base);
    } else if (flat.status === 'pending_payment') {
      pending.push(base);
    }
  }
}

// Write outputs
fs.writeFileSync(outputConfirmedPath, stringify(confirmed, { header: true }));
fs.writeFileSync(outputPendingPath, stringify(pending, { header: true }));

console.log('Cleaned CSVs generated successfully.');
console.log(`- Confirmed: ${confirmed.length} rows`);
console.log(`- Pending: ${pending.length} rows`);