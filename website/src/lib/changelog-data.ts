// Typed, build-time access to the changelog feed derived from the repo's
// CHANGELOG.md by website/scripts/build-changelog.mjs. Imported statically so
// the data is baked into the static export — no runtime fetch.
import data from "../../public/data/changelog.json";

export interface ChangelogSection {
  category: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
  note: string | null;
}

export const changelog = data as ChangelogEntry[];
