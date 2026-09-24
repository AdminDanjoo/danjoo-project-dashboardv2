-- The dashboard is now public; client addresses are no longer collected or displayed.
-- Purge any address data already stored from a previous deploy.
UPDATE dashboard_projects SET data = data - 'addr' WHERE data ? 'addr';
UPDATE dashboard_tasks SET data = data - 'addr' WHERE data ? 'addr';
