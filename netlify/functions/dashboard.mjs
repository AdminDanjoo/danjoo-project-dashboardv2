import { getDatabase } from "@netlify/database";

/* "addr" is deliberately absent — the dashboard went public and no longer collects or serves
   client addresses (see the 20260924000000_remove_address migration, which purges the ones
   already stored). "phases" replaces the old flat stage/start/end model with a per-project list
   the client can add to and reorder. */
const PROJECT_FIELDS = new Set([
  "client", "type", "quote", "job", "status", "stage", "pct",
  "priority", "modified", "comment", "start", "end", "liftOrdered",
  "liftExpected", "siteVisit", "clientMeeting", "feasibilityOutcome",
  "clientAgreedDate", "feasibilityDue", "deleted", "phases"
]);

const TASK_FIELDS = new Set([
  "projectIdx", "client", "phase", "task", "owner", "status",
  "pct", "start", "end", "comment", "deleted", "whatOverride"
]);

const PHASE_FIELDS = new Set(["name", "start", "end", "status"]);

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function validIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
}

function cleanValue(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (value.length > 5_000) throw new Error("Text value is too large");
    if (/[<>]/.test(value)) throw new Error("Text cannot contain angle brackets");
    return value;
  }
  throw new Error("Invalid field value");
}

function cleanPhase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid phase");
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (PHASE_FIELDS.has(key)) clean[key] = cleanValue(item);
  }
  return clean;
}

function cleanPhases(value) {
  if (!Array.isArray(value)) throw new Error("Phases must be an array");
  if (value.length > 20) throw new Error("Too many phases");
  return value.map(cleanPhase);
}

function cleanRecord(value, allowedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid record");
  }

  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "idx") { clean[key] = cleanValue(item); continue; }
    if (!allowedFields.has(key)) continue;
    clean[key] = key === "phases" ? cleanPhases(item) : cleanValue(item);
  }

  const encoded = JSON.stringify(clean);
  if (encoded.length > 50_000) throw new Error("Record is too large");
  return clean;
}

function cleanOwners(value) {
  if (!Array.isArray(value)) throw new Error("Owners must be an array");
  const owners = [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  if (!owners.length || owners.length > 100 || owners.some(owner => owner.length > 100 || /[<>\"]/.test(owner))) {
    throw new Error("Invalid owner list");
  }
  return owners;
}

async function readState(db) {
  const [projectRows, taskRows, configRows] = await Promise.all([
    db.sql`SELECT data FROM dashboard_projects ORDER BY id`,
    db.sql`SELECT data FROM dashboard_tasks ORDER BY id`,
    db.sql`SELECT data FROM dashboard_config WHERE key = ${"main"}`
  ]);

  /* Defense in depth alongside the remove_address migration: even if an old "addr" value is
     still sitting in a row for any reason, it never leaves this function. */
  const projects = projectRows.map(row => { const { addr, ...rest } = row.data; return rest; });
  const tasks = taskRows.map(row => { const { addr, ...rest } = row.data; return rest; });
  const owners = configRows[0]?.data?.owners ?? [];

  return {
    initialized: configRows.length > 0,
    projects,
    tasks,
    owners
  };
}

async function seed(db, body) {
  const projects = Array.isArray(body.projects) ? body.projects : [];
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const owners = cleanOwners(body.owners);

  for (const input of projects) {
    const project = cleanRecord(input, PROJECT_FIELDS);
    if (!validIndex(project.idx)) throw new Error("Invalid project index");
    await db.sql`
      INSERT INTO dashboard_projects (id, data)
      VALUES (${project.idx}, ${JSON.stringify(project)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const input of tasks) {
    const task = cleanRecord(input, TASK_FIELDS);
    if (!validIndex(task.idx)) throw new Error("Invalid task index");
    await db.sql`
      INSERT INTO dashboard_tasks (id, data)
      VALUES (${task.idx}, ${JSON.stringify(task)}::jsonb)
      ON CONFLICT (id) DO NOTHING
    `;
  }

  await db.sql`
    INSERT INTO dashboard_config (key, data)
    VALUES (${"main"}, ${JSON.stringify({ owners })}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
}

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const db = getDatabase();

    if (request.method === "GET") {
      return json(await readState(db));
    }

    const body = await request.json();
    const action = body?.action;

    if (action === "seed") {
      await seed(db, body);
    } else if (action === "upsertProject") {
      const project = cleanRecord(body.project, PROJECT_FIELDS);
      if (!validIndex(project.idx)) throw new Error("Invalid project index");
      await db.sql`
        INSERT INTO dashboard_projects (id, data, updated_at)
        VALUES (${project.idx}, ${JSON.stringify(project)}::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
    } else if (action === "patchProject") {
      if (!validIndex(body.idx)) throw new Error("Invalid project index");
      const patch = cleanRecord(body.patch, PROJECT_FIELDS);
      delete patch.idx;
      await db.sql`
        UPDATE dashboard_projects
        SET data = data || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
        WHERE id = ${body.idx}
      `;
    } else if (action === "upsertTask") {
      const task = cleanRecord(body.task, TASK_FIELDS);
      if (!validIndex(task.idx)) throw new Error("Invalid task index");
      await db.sql`
        INSERT INTO dashboard_tasks (id, data, updated_at)
        VALUES (${task.idx}, ${JSON.stringify(task)}::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
    } else if (action === "patchTask") {
      if (!validIndex(body.idx)) throw new Error("Invalid task index");
      const patch = cleanRecord(body.patch, TASK_FIELDS);
      delete patch.idx;
      await db.sql`
        UPDATE dashboard_tasks
        SET data = data || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
        WHERE id = ${body.idx}
      `;
    } else if (action === "setOwners") {
      const owners = cleanOwners(body.owners);
      await db.sql`
        INSERT INTO dashboard_config (key, data, updated_at)
        VALUES (${"main"}, ${JSON.stringify({ owners })}::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
    } else {
      return json({ error: "Unknown action" }, 400);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("dashboard function error", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    const isClientError = /Invalid|too large|Owners|Unknown|Phases|phases/.test(message);
    return json({ error: isClientError ? message : "Database request failed" }, isClientError ? 400 : 500);
  }
};

export const config = {
  path: "/api/dashboard"
};
