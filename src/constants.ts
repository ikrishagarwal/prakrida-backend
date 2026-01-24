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
  Carrom = 2625
}

// It's for mapping the events with their collection names in Firestore
export const EventMappings: Record<number, string> = {
    [Tickets.VolleyballMen]: "volleyball_men",
  [Tickets.VolleyballWomen]: "volleyball_women",

  [Tickets.BasketballMen]: "basketball_men",
  [Tickets.BasketballWomen]: "basketball_women",

  [Tickets.CricketMen]: "cricket_men",
  [Tickets.CricketWomen]: "cricket_women",

  [Tickets.FootballMen]: "football_men",
  [Tickets.FootballWomen]: "football_women",

  [Tickets.BadmintonMen]: "badminton_men",
  [Tickets.BadmintonWomen]: "badminton_women",

  [Tickets.TableTennisTeamMen]: "tt_team_men",
  [Tickets.TableTennisTeamWomen]: "tt_team_women",
  [Tickets.TableTennisSoloMen]: "tt_solo_men",
  [Tickets.TableTennisWomenSolo]: "tt_solo_women",
  [Tickets.TableTennisMixedDoubles]: "tt_mixed_doubles",

  [Tickets.ChessMen]: "chess_men",
  [Tickets.ChessWomen]: "chess_women",

  [Tickets.FreeFire]: "free_fire",
  [Tickets.BGMIValorant]: "bgmi_valorant",
  [Tickets.Carrom]: "carrom",
};
