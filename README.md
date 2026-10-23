# Mindful Bite (React Native / Expo)

## 1. Project Overview

A lightning-fast, ultra-lightweight mobile application designed for personal daily food and calorie tracking.

* **Core Philosophy:** **100% Offline-First & Zero Backend.** No cloud databases, no user authentication or login screens, and zero internet dependency.
* **Target Platforms:** Cross-platform mobile (Android & iOS) built using React Native and Expo.
* **Data Privacy:** Reference foods, the optional profile name, appearance preference, and daily logs reside inside the device's local SQLite database.

## 2. Technical Stack & Dependencies

* **Framework:** React Native with Expo (`expo`)
* **Local Database Engine:** `expo-sqlite` (using synchronous local execution for instant UI responsiveness)
* **File System:** `expo-file-system`
* **Master Data Source:** Bundled JSON asset (`App/assets/food_nutrition_processed.json`) derived from Indonesian nutrition data, automatically seeded into local SQLite on first app launch. The app uses the macro-derived `calculated_total_calories` value and stores nutrients on a per-100-gram basis.

## Run the App

From the `App` directory, install the dependencies and start Expo:

```bash
npm install
npx expo start
```

Use the Expo terminal options to open the app on an Android or iOS device or emulator. The food library is bundled with the app; diary entries are saved locally in SQLite and do not require an account or network connection.

On first launch, the app asks what to call you and saves that name locally. The welcome prompt appears again if the app's local data is cleared or the app is reinstalled.

## Build and Install on Phones

An Android APK can only be installed on Android. iPhones require a separately built and signed iOS app (IPA); an APK cannot be installed on iOS. These cloud builds use Expo Application Services (EAS Build).

1. Install EAS CLI and sign in to your Expo account:

   ```bash
   npm install --global eas-cli
   eas login
   ```

2. From the `App` directory, build an installable Android APK:

   ```bash
   eas build --platform android --profile preview
   ```

   When the build completes, open the build link on your Android phone, download the APK, and allow installation from that source if Android asks.

3. To install on a physical iPhone, enroll in the Apple Developer Program, register the iPhone with EAS when prompted, and build the signed iOS app:

   ```bash
   eas build --platform ios --profile preview
   ```

   Open the EAS build link on the registered iPhone and follow its installation instructions. For wider distribution through TestFlight or the App Store, use the `production` profile instead; an Apple Developer account is required.

The `preview` profile creates an Android APK and an internally distributed iOS build. EAS Build runs remotely, so a local Android SDK/Xcode installation is not needed. See [`App/eas.json`](App/eas.json) for build profiles. The application identifiers are `com.mindfulbite.app` on both platforms.

## 3. Design System & Global Color Palette

The UI uses the four-color palette supplied in `App/assets`: violet `#937DC2`, mauve `#C689C6`, pink `#FFABE1`, and pale pink `#FFE6F7`. Light mode is the default; tap the theme icon on the home screen to switch between light and dark modes. The selection is saved locally and transitions with a brief crossfade.

### Shared Theme and Styles

Shared palette tokens and React Native styles live in `App/styles.js`, the native equivalent of a global stylesheet. Keep screen styles theme-aware by using the shared style factory and palette rather than adding fixed light/dark colors in screens.

Screen navigation uses an explicit Back button, Android hardware Back, and an iOS left-edge swipe gesture to return from Add or Maintenance to Home.

## 4. Data Normalization Utility (Per 1 Gram Base)

The master dataset (`App/assets/food_nutrition_processed.json`) supplies nutrients per **100 grams**. The calorie value used by the app is `calculated_total_calories`, derived from protein, carbohydrates, and fat. During logging, the app scales these per-100-gram values by the serving weight (e.g., a 75 g serving uses a factor of 0.75).

### Calculation Logic:
$$\text{Logged Nutrient} = \left( \frac{\text{Nutrient Value per 100g}}{100} \right) \times \text{Logged Weight (grams)}$$

```javascript
export const normalizeFoodItem = (food, targetGrams) => {
  const factor = targetGrams / 100;
  return {
    calories: (food.calculated_total_calories ?? food.calories) * factor,
    protein: (food.protein || 0) * factor,
    carbs: (food.carbs || 0) * factor,
    fat: (food.fat || 0) * factor,
  };
};
```

## 5. Architecture & Application Flow

To keep the codebase lean and maintainable, the app follows a **Single-Page Application (SPA)** style managed entirely via local React state (`useState`) without heavy routing libraries.

### View States (`screen` state)

* **`HOME` (Main Dashboard - All-in-One View):**
  * **Today's Intake Card:** Greets the saved profile name and displays today's total calories and macronutrients with a prominent **`+ Add Food`** button.
  * **Swipeable Dashboard Cards:** The labeled card navigation provides a 7-day chart, date-range summaries (7 days, 30 days, or custom) with calorie and macro totals and per-day averages, and grouped meals. Tap a day in the 7-day chart to open that date's meals for editing or deletion.
  * **Grouped Meals:** Entries are categorized into **Breakfast**, **Lunch**, **Dinner**, and **Snack** sections with inline edit/delete actions.
  * **Footer Action:** Secondary button to access `MAINTENANCE` storage cleanup.

* **`ADD` (Dedicated Food Search & Logging View):**
  * Real-time search filtering local master SQLite `foods` table.
  * Meal type selector (`breakfast` | `lunch` | `dinner` | `snack`).
  * Serving weight input in grams (default: `100g`).
  * "Save Log Entry" calculates per-1g values and inserts into `intake_logs`.

* **`MAINTENANCE` (Storage Clean-up View):**
  * Allows selecting/typing a cutoff date (`YYYY-MM-DD`).
  * Executes a purge query (`DELETE FROM intake_logs WHERE date < ?`).

## 6. Local Database Schema

### Table 1: `foods` (Read-Only Master Catalog)
```sql
CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  calories REAL NOT NULL, -- per 100g base value
  protein REAL,          -- per 100g base value
  carbs REAL,            -- per 100g base value
  fat REAL               -- per 100g base value
);
```

### Table 2: `intake_logs` (User Daily Transactional Data)
```sql
CREATE TABLE IF NOT EXISTS intake_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                      -- Format: YYYY-MM-DD
  meal_type TEXT NOT NULL DEFAULT 'snack', -- 'breakfast', 'lunch', 'dinner', 'snack'
  food_name TEXT NOT NULL,
  calories REAL NOT NULL,                  -- Calculated for logged weight
  protein REAL DEFAULT 0,                  -- Calculated for logged weight
  carbs REAL DEFAULT 0,                    -- Calculated for logged weight
  fat REAL DEFAULT 0,                      -- Calculated for logged weight
  serving_qty REAL NOT NULL                -- Weight in grams
);
```

### Key Analytical Queries

* **Grouped Today Logs (By Meal Category):**
  ```sql
  SELECT * FROM intake_logs
  WHERE date = ?
  ORDER BY CASE meal_type
    WHEN 'breakfast' THEN 1
    WHEN 'lunch' THEN 2
    WHEN 'dinner' THEN 3
    ELSE 4
  END;
  ```

* **Last 7 Days Rolling Summary (e.g., date between $T-6$ and $T$):**
  ```sql
  SELECT date,
         SUM(calories) AS daily_calories,
         SUM(protein) AS daily_protein,
         SUM(carbs) AS daily_carbs,
         SUM(fat) AS daily_fat
  FROM intake_logs
  WHERE date BETWEEN date('now', '-6 days') AND date('now')
  GROUP BY date
  ORDER BY date DESC;
  ```

## 7. Development Instructions for AI Agent

1. **Initialize Project:** Create an Expo project using `npx create-expo-app@latest`.
2. **Install Packages:** Run `npx expo install expo-sqlite expo-file-system`.
3. **Asset Setup:** Ensure `assets/foods.json` is placed with items containing 100g base values for `calories`, `protein`, `carbs`, and `fat`.
4. **Implementation:** Build out the modular structure adhering to per-gram normalization rules, 7-day rolling intake analytics, meal-category grouping (`breakfast`, `lunch`, `dinner`, `snack`), and `COLORS` palette defined above. Ensure zero network requests are made.