import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({ showForm: true });
};

export default function Index() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>DelayGuard</title>
        <style>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: #f6f6f7;
          }
          .card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 400px;
            width: 100%;
          }
          h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
          p { color: #6b7177; margin: 0 0 1.5rem; }
          label { display: block; font-weight: 500; margin-bottom: 0.5rem; }
          input[type="text"] {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #c9cccf;
            border-radius: 8px;
            font-size: 1rem;
            box-sizing: border-box;
            margin-bottom: 1rem;
          }
          button {
            background: #008060;
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-size: 1rem;
            cursor: pointer;
            width: 100%;
          }
          button:hover { background: #006e52; }
        `}</style>
      </head>
      <body>
        <div className="card">
          <h1>DelayGuard</h1>
          <p>Proactive shipment delay detection for Shopify stores.</p>
          <Form method="get" action="/app">
            <label htmlFor="shop">Shop domain</label>
            <input
              id="shop"
              name="shop"
              type="text"
              placeholder="my-store.myshopify.com"
            />
            <button type="submit">Log in</button>
          </Form>
        </div>
      </body>
    </html>
  );
}
