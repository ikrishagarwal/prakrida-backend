# Backend Service for Prakrida 26

This repository contains the backend service for Prakrida 26, the annual sports fest at BIT Patna, built using Fastify and TypeScript.

# Endpoints

- `GET /`: Health check endpoint to verify that the server is running.

# Technologies Used

- Fastify: A fast and low-overhead web framework for Node.js.
- TypeScript: A strongly typed programming language that builds on JavaScript.

# Setup Instructions

1. Install `Node.js`, `pnpm` and `Nodemon` if you haven't already.
2. Run `pnpm install`
3. Make a copy of `.env.example` and rename it to `.env`. Fill in the required environment variables.
4. Create a Firebase service account and download the JSON key file. Save it in `.env` file.
5. Run `pnpm run dev` to watch for TypeScript changes and run the server concurrently.

# Important Information

- Base URL: `http://localhost:3000`

# Authors

- [Krish](https://github.com/ikrishagarwal)
