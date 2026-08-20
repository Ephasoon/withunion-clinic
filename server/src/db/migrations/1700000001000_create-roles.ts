import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("roles", {
    id: "id",
    name: { type: "varchar(32)", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Seed the six approved roles. Additional roles can be added later
  // via migration without touching application code, since RBAC
  // logic keys off the role name string.
  pgm.sql(`
    INSERT INTO roles (name) VALUES
      ('owner'),
      ('reception'),
      ('nurse'),
      ('doctor'),
      ('lab_tech'),
      ('pharmacy');
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("roles");
}
