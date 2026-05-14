# ECU Room Data Hub

Room Data Hub is a TypeScript React MVP for managing ECU rooms as governed enterprise assets. It demonstrates a searchable room source of truth for Outlook/O365 room bookings, Archibus, timetabling, Appspace, Momentus, maintenance systems, security/access groups, and future integrations.

## What Is Included

- React + TypeScript + Vite frontend
- Tailwind CSS enterprise UI rebranded around ECU's refreshed black and green visual identity
- Supabase client wiring with demo-data fallback
- Supabase PostgreSQL migration with RLS policies
- Seed data for campuses, buildings, systems, patterns, attributes, rooms, and transformation rules
- Room search with simple and advanced filters
- Room profile pages separating physical, booking, access, attribute, and system mapping data
- Admin room editing and configurable attribute management
- Room pattern and category management views
- Transformation rules view
- Governance workflow dashboard with approvals, history, and generated implementation checklists
- CSV import wizard with column mapping, dynamic field creation, validation preview, and commit flow
- CSV export from filtered room search results

## Quick Start

```bash
npm install
npm run dev
```

The app runs in demo data mode until Supabase credentials are configured.

## Supabase Setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env`.
3. Add your project values:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

4. Apply the schema:

```bash
supabase db push
```

5. Seed sample data:

```bash
supabase db reset
```

The migration is in `supabase/migrations/202605140001_initial_schema.sql`; sample records are in `supabase/seed.sql`.

## Data Model

The schema uses a hybrid model:

- Stable room asset records in `rooms`
- Configurable fields in `room_attribute_definitions`
- Per-room flexible values in `room_attribute_values`
- Governed categories and patterns in `room_categories` and `room_patterns`
- Integration readiness in `systems`, `system_mappings`, and `transformation_rules`
- Governance in `change_requests`, `approvals`, `implementation_templates`, and `implementation_tasks`
- Audit and import records in `room_change_log` and `import_jobs`

## Roles

The migration defines these roles:

- Viewer
- Room Data Editor
- System Owner
- Approver
- Admin

RLS policies allow authenticated users to read room/reference data, while editors and admins can manage rooms/imports, admins can manage configuration, and approvers can action approval records.

## MVP Notes

This MVP intentionally does not call external O365, Archibus, timetabling, Appspace, Momentus, security, or maintenance APIs. Instead, it models the governance, mapping, transformation, and operational task structure needed to add those integrations later.

## Branding

The UI references ECU's public 2025 refreshed identity announcement and uses the public logo image from ECU's newsroom page. The palette has been adjusted to a black/white foundation with green-teal accents that match the new gum-leaf direction.

## Verification

```bash
npm run build
```

The production build compiles TypeScript and bundles the app with Vite.
