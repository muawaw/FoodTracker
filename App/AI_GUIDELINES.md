# Project Guidelines: Offline Personal Food Tracker

## 1. Project Overview & Core Philosophy
* **Type:** Cross-platform mobile application (Android & iOS via React Native / Expo).
* **Primary Objective:** Ultra-lightweight, lightning-fast personal daily food and calorie tracker.
* **Core Philosophy:** **100% Offline-First & Zero Backend.** No cloud databases, no user authentication/login, and zero internet dependency. All master food data and user logs reside locally on the device's storage sandbox.

## 2. Technical Stack & Dependencies
* **Framework:** React Native with Expo (`expo` / `expo-sqlite`).
* **Database Engine:** SQLite (`expo-sqlite`) for local structured queries and transactional logging.
* **Master Data Source:** Bundled JSON asset (`assets/foods.json`) derived from Indonesian nutrition datasets (TKPI / Kaggle), seeded into local SQLite on first app launch.
* **Styling & UI:** React Native `StyleSheet` using the shared light/dark palette and global theme in `styles.js`.

## 3. Design Standards & Standardized Color Codes
Use the palette from the supplied Color Hunt image: violet `#937DC2`, mauve `#C689C6`, pink `#FFABE1`, and pale pink `#FFE6F7`. Light mode is the default; users can switch between light and dark modes using the home-screen theme icon. Keep supporting colors close to these hues while maintaining readable contrast.

All screen-wide colors and component styles belong in `styles.js`; do not hard-code theme-specific colors in screens.

## 4. Architecture & UI Layout Rules
* **Single-Page Application (SPA) State Navigation:**
  * Do not use heavy routing libraries (React Navigation / Expo Router).
  * Switch between screens (`HOME`, `ADD`, `MAINTENANCE`) using local React state (`useState`).
  * Keep a visible Back button on secondary screens, support Android hardware Back, and support an iOS left-edge swipe to return Home.
* **HOME View Layout Structure:**
  1. **Top Summary Card:** Current date, today's total calories, macro totals (Protein, Carbs, Fat), and primary `+ Add Food` CTA.
  2. **7-Day Rolling Analytics:** Summary metrics and day-by-day fraction list for the past 7 days (e.g., $T-6$ to $T$).
  3. **Grouped Today's Meals:** Logged entries categorized into `breakfast`, `lunch`, `dinner`, and `snack` with inline edit/delete actions.
* **Data Flow & Storage Rules:**
  * **Data Normalization:** Always normalize raw 100g database values to per-1g calculations when saving entries.
  * **Master Food Library:** Read-only reference table populated once from `foods.json`.
  * **Daily Intake Logs:** Local transactional table (`intake_logs`) storing daily entries, meal categories, gram weights, and calculated macros.
  * **Storage Maintenance:** Provide a manual date-range purge view (`DELETE FROM intake_logs WHERE date < ?`).

## 5. Coding Conventions & Best Practices
* **Simplicity First:** Keep file structures flat and straightforward. Avoid unnecessary abstraction layers.
* **Performance:** Use synchronous SQLite execution (`db.execSync`, `db.getAllSync`, `db.runSync`) where appropriate for instant local UI responsiveness.
* **Error Handling:** Use React Native `Alert` components for user confirmations (e.g., record deletion, storage purging).