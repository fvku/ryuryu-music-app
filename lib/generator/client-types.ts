import type { GeneratorDocument } from "./model";

export type GeneratorSummary = {
  id: string;
  series: "monthly" | "japan" | "weekly";
  periodStart: string;
  periodEnd: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type GeneratorLockView = { kind: string; targetId: string; owner: string; expiresAt: string };

export type GeneratorSnapshot = {
  document: GeneratorDocument;
  version: number;
  themeVersion: number;
  structureVersion: number;
  pageVersions: Record<string, number>;
  itemVersions: Record<string, number>;
  updatedAt: string;
  updatedBy: string;
  locks: GeneratorLockView[];
};

export type GeneratorHistoryEntry = {
  version: number;
  actor: string;
  operation: "create" | "save" | "restore" | "reimport";
  targetKind: "item" | "page" | "theme" | "structure" | null;
  targetId: string | null;
  restoredFrom: number | null;
  createdAt: string;
};
