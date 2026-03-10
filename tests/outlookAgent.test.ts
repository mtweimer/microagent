// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";

import { OutlookAgent } from "../src/agents/ms/outlookAgent.js";

test("outlook search_email applies unread+today filters", async () => {
  let requestedPath = "";
  const graphClient = {
    async get(path) {
      requestedPath = path;
      return { value: [] };
    }
  };

  const agent = new OutlookAgent();
  const out = await agent.execute(
    {
      requestId: "r1",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "search_email",
      params: { query: "unread messages today" }
    },
    { graphClient }
  );

  assert.equal(out.status, "ok");
  assert.match(requestedPath, /^\/me\/messages\?/);
  assert.match(requestedPath, /\$filter=/);
  assert.match(requestedPath, /isRead%20eq%20false/);
  assert.equal(out.artifacts.searchMode, "filter_unread_today");
});

test("outlook search_email avoids orderby when using $search", async () => {
  let requestedPath = "";
  const graphClient = {
    async get(path) {
      requestedPath = path;
      return { value: [] };
    }
  };

  const agent = new OutlookAgent();
  const out = await agent.execute(
    {
      requestId: "r2",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "search_email",
      params: { query: "invoices from microsoft" }
    },
    { graphClient }
  );

  assert.equal(out.status, "ok");
  assert.match(requestedPath, /\$search=/);
  assert.doesNotMatch(requestedPath, /\$orderby=/);
  assert.equal(out.artifacts.searchMode, "search");
});

test("outlook search_email uses top_n_recent mode for latest query", async () => {
  let requestedPath = "";
  const graphClient = {
    async get(path) {
      requestedPath = path;
      return { value: [] };
    }
  };

  const agent = new OutlookAgent();
  const out = await agent.execute(
    {
      requestId: "r3",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "search_email",
      params: { query: "last 2 emails" }
    },
    { graphClient }
  );

  assert.equal(out.status, "ok");
  assert.match(requestedPath, /\$top=2/);
  assert.match(requestedPath, /\$orderby=receivedDateTime desc/);
  assert.equal(out.artifacts.searchMode, "top_n_recent");
});

test("outlook list_recent_emails returns ordered top results", async () => {
  let requestedPath = "";
  const graphClient = {
    async get(path) {
      requestedPath = path;
      return {
        value: [
          {
            id: "m1",
            subject: "A",
            from: { emailAddress: { address: "a@example.com" } },
            receivedDateTime: "2026-03-04T00:00:00Z",
            bodyPreview: "Preview A"
          }
        ]
      };
    }
  };

  const agent = new OutlookAgent();
  const out = await agent.execute(
    {
      requestId: "r4",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "list_recent_emails",
      params: { limit: 2 }
    },
    { graphClient }
  );

  assert.equal(out.status, "ok");
  assert.match(requestedPath, /\$top=2/);
  assert.match(requestedPath, /\$orderby=receivedDateTime desc/);
  assert.equal(out.artifacts.messages[0].id, "m1");
});

test("outlook read_email reads selected message by id", async () => {
  let requestedPath = "";
  const graphClient = {
    async get(path) {
      requestedPath = path;
      return {
        id: "m2",
        subject: "Subject",
        from: { emailAddress: { address: "b@example.com" } },
        receivedDateTime: "2026-03-04T00:00:00Z",
        bodyPreview: "Preview B",
        body: { content: "Body B" }
      };
    }
  };

  const agent = new OutlookAgent();
  const out = await agent.execute(
    {
      requestId: "r5",
      schemaVersion: "1.0.0",
      agent: "ms.outlook",
      action: "read_email",
      params: { id: "m2" }
    },
    { graphClient }
  );

  assert.equal(out.status, "ok");
  assert.match(requestedPath, /\/me\/messages\/m2\?/);
  assert.equal(out.artifacts.subject, "Subject");
});
