import type { PrescriptionDetail } from "../doctor/types";

export interface PendingByPrescription {
  prescriptionId: string;
  createdAt: string;
  medicineNames: string[];
}

export interface PendingMedicine {
  prescriptionId: string;
  medicineName: string;
}

/**
 * Items still PENDING across every prescription on the visit. Completing
 * pharmacy is refused while this is non-empty (docs §5.8); partly
 * dispensed, dispensed and unavailable items do not block it.
 */
export function pendingItems(visitPrescriptions: readonly PrescriptionDetail[]): PendingByPrescription[] {
  return visitPrescriptions
    .map((p) => ({
      prescriptionId: p.id,
      createdAt: p.createdAt,
      medicineNames: p.items.filter((i) => i.status === "PENDING").map((i) => i.medicineName),
    }))
    .filter((entry) => entry.medicineNames.length > 0);
}

const PREFIX = "Cannot complete: still pending for ";
const OTHER_PRESCRIPTION =
  /^(.+) \(prescription ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

/**
 * Parses an INCOMPLETE_DISPENSING message:
 *   "Cannot complete: still pending for Amoxicillin, ORS (prescription <uuid>)"
 * Medicines on the prescription being completed are bare names; those on
 * the visit's other prescriptions are suffixed " (prescription <id>)".
 *
 * Returns null — so the caller shows the raw message — when the format is
 * unexpected. Medicine names are free text and may contain ", ", which
 * would split wrongly; passing `known` (the loaded pending items) rejects
 * any parse whose names don't all match a real pending medicine.
 */
export function parseIncompleteDispensing(
  message: string,
  completingPrescriptionId: string,
  known?: readonly PendingMedicine[]
): PendingMedicine[] | null {
  if (!message.startsWith(PREFIX)) return null;
  const list = message.slice(PREFIX.length).trim();
  if (list === "") return null;

  const parsed: PendingMedicine[] = [];
  for (const part of list.split(", ")) {
    const name = part.trim();
    if (name === "") return null;
    const other = OTHER_PRESCRIPTION.exec(name);
    parsed.push(
      other
        ? { medicineName: other[1]!, prescriptionId: other[2]! }
        : { medicineName: name, prescriptionId: completingPrescriptionId }
    );
  }

  if (known) {
    const keys = new Set(known.map((m) => `${m.prescriptionId}\u0000${m.medicineName}`));
    if (!parsed.every((m) => keys.has(`${m.prescriptionId}\u0000${m.medicineName}`))) return null;
  }
  return parsed;
}
