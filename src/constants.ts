export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
export const FRONT_END_BASE_URL =
  process.env.FRONT_END_BASE_URL || "https://localhost:5173";
export const ApiToken = process.env.API_TOKEN || "";
export const WebhookSecret = process.env.WEBHOOK_TOKEN || "";

export const PaymentBaseUrl = "https://payments.juspay.in/payment-page/order/";

export enum PaymentStatus {
  Confirmed = "confirmed",
  Failed = "failed",
  PendingPayment = "pending_payment",
}

// Use this if you're using Event based ticketing
// NOTE: Add all the ticket IDs here instead of hardcoding them
export enum Tickets {
  VolleyballMen = 2611,
  BasketballWomen = 2614,
  FreeFire = 2618,
  LawnTennis = 2619,
  TableTennisTeamWomen = 2621,
  TableTennisWomenSolo = 2623,
  VolleyballWomen = 2612,
  BadmintonMen = 2615,
  TableTennisSoloMen = 2622,
  BasketballMen = 2613,
  BadmintonWomen = 2616,
  BGMIValorant = 2617,
  TableTennisTeamMen = 2620,
  TableTennisMixedDoubles = 2624,
  CricketMen = 2605,
  CricketWomen = 2606,
  FootballMen = 2607,
  FootballWomen = 2608,
  ChessMen = 2609,
  ChessWomen = 2610,
  Carrom = 2625,
  Accommodation = 2626,
}

// It's for mapping the events with their collection names in Firestore
export const EventMappings: Record<number, string> = {
  [Tickets.Accommodation]: "accommodation",
};

export const EventIds: Record<number, Tickets> = {
  // --- Cricket ---
  1: Tickets.CricketMen, // Cricket: Men's
  2: Tickets.CricketWomen, // Cricket: Women's

  // --- Football ---
  3: Tickets.FootballMen, // Football: Men's
  4: Tickets.FootballWomen, // Football: Women's

  // --- Chess ---
  5: Tickets.ChessMen, // Chess: Men's
  6: Tickets.ChessWomen, // Chess: Women's

  // --- Volleyball ---
  7: Tickets.VolleyballMen, // Volleyball: Men's
  8: Tickets.VolleyballWomen, // Volleyball: Women's

  // --- Basketball ---
  9: Tickets.BasketballMen, // Basketball: Men's
  10: Tickets.BasketballWomen, // Basketball: Women's

  // --- Badminton ---
  11: Tickets.BadmintonMen, // Badminton: Men's
  12: Tickets.BadmintonWomen, // Badminton: Women's

  // --- E-sports ---
  13: Tickets.BGMIValorant, // E-sports: BGMI
  14: Tickets.BGMIValorant, // E-sports: Valorant
  15: Tickets.FreeFire, // E-sports: Free-Fire

  // --- Lawn-Tennis ---
  16: Tickets.LawnTennis, // Lawn-Tennis: Men's
  17: Tickets.LawnTennis, // Lawn-Tennis: Women's

  // --- Table Tennis ---
  18: Tickets.TableTennisTeamMen, // Table Tennis: Team Men's
  19: Tickets.TableTennisTeamWomen, // Table Tennis: Team Women's
  20: Tickets.TableTennisSoloMen, // Table Tennis: Single Men's
  21: Tickets.TableTennisWomenSolo, // Table Tennis: Single Women's
  22: Tickets.TableTennisMixedDoubles, // Table Tennis: Mixed Double

  // --- Carrom ---
  23: Tickets.Carrom, // Carrom: Men's
  24: Tickets.Carrom, // Carrom: Women's
  25: Tickets.Carrom, // Carrom: Mixed Double
};

export const EventTicketIds = Object.values(Tickets) as number[];
