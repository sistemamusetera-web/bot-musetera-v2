import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleEvolutionWebhook } from "../bot/webhook-handler";
import { handleMercadoPagoWebhook } from "../bot/payment-webhook";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads.
  // Keep the exact raw bytes so webhook HMAC validation can use them.
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody?: string }).rawBody = buf.toString(
          "utf-8"
        );
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.get("/api/webhooks/evolution", (_req, res) =>
    res.json({ ok: true, service: "musetera-bot" })
  );
  // Evolution's "webhook by events" mode appends /<event-name> to the URL
  // (e.g. /api/webhooks/evolution/messages-upsert); accept that suffix too,
  // otherwise that configuration ends in a 404 and the bot stays silent.
  app.post(
    ["/api/webhooks/evolution", "/api/webhooks/evolution/:eventSlug"],
    (req, res) => {
      handleEvolutionWebhook(req, res).catch(error => {
        console.error("[webhook] unhandled error", error);
        if (!res.headersSent)
          res.status(500).json({ ok: false, error: "internal webhook error" });
      });
    }
  );
  for (const path of ["/api/public/mp-webhook", "/api/webhooks/mercadopago"]) {
    app.post(path, (req, res) => {
      handleMercadoPagoWebhook(req, res).catch(error => {
        console.error("[mercadopago-webhook] unhandled error", error);
        if (!res.headersSent)
          res
            .status(500)
            .json({ ok: false, error: "internal payment webhook error" });
      });
    });
  }
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
