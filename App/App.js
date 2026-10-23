import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SQLite from "expo-sqlite";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import foodData from "./assets/food_nutrition_processed.json";
import darkThemeIcon from "./assets/night-mode.png";
import lightThemeIcon from "./assets/light-mode.png";
import { createStyles, getNextThemeMode, resolveColors } from "./styles";

const MEALS = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLogsForDate(database, date) {
  return database.getAllSync(
    `SELECT id, date, meal_type, food_name, calories, protein, carbs, fat, serving_qty
     FROM intake_logs WHERE date = ? ORDER BY id DESC`,
    date,
  );
}

function lastSevenDates() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 6 + index,
    );
    return localDateString(date);
  });
}

function dateRangeEndingToday(dayCount) {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - dayCount + 1,
  );
  return [localDateString(start), localDateString(today)];
}

function inclusiveDayCount(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay);
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function caloriesForFood(food) {
  return Number(food.calculated_total_calories ?? food.calories ?? 0);
}

function initializeDatabase() {
  const database = SQLite.openDatabaseSync("food-tracker.db");
  database.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS intake_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL DEFAULT 'snack',
      food_name TEXT NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      serving_qty REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS intake_logs_date_idx ON intake_logs(date);
  `);

  const existingFoods = database.getFirstSync(
    "SELECT COUNT(*) AS count FROM foods",
  );
  if (existingFoods.count === 0) {
    database.withTransactionSync(() => {
      for (const food of foodData) {
        database.runSync(
          `INSERT OR IGNORE INTO foods (id, name, calories, protein, carbs, fat)
           VALUES (?, ?, ?, ?, ?, ?)`,
          food.id,
          food.name || "Unnamed food",
          caloriesForFood(food),
          Number(food.protein_g ?? food.proteins ?? 0),
          Number(food.carbs_g ?? food.carbohydrate ?? 0),
          Number(food.fat_g ?? food.fat ?? 0),
        );
      }
    });
  }

  const savedTheme = database.getFirstSync(
    "SELECT value FROM app_settings WHERE key = ?",
    "theme_mode",
  );
  const savedName = database.getFirstSync(
    "SELECT value FROM app_settings WHERE key = ?",
    "user_name",
  );
  const themeMode = savedTheme?.value === "dark" ? "dark" : "light";

  return { database, themeMode, userName: savedName?.value?.trim() || "" };
}

function getDashboardSnapshot(database) {
  const today = localDateString();
  const dates = lastSevenDates();
  const stats = database.getAllSync(
    `SELECT date,
            SUM(calories) AS calories,
            SUM(protein) AS protein,
            SUM(carbs) AS carbs,
            SUM(fat) AS fat
     FROM intake_logs
     WHERE date BETWEEN ? AND ?
     GROUP BY date`,
    dates[0],
    today,
  );
  const statsByDate = new Map(stats.map((entry) => [entry.date, entry]));

  return {
    todayLogs: getLogsForDate(database, today),
    weeklyStats: dates.map((date) => ({
      date,
      calories: Number(statsByDate.get(date)?.calories || 0),
      protein: Number(statsByDate.get(date)?.protein || 0),
      carbs: Number(statsByDate.get(date)?.carbs || 0),
      fat: Number(statsByDate.get(date)?.fat || 0),
    })),
  };
}

function getRangeSummary(database, start, end) {
  const totals = database.getFirstSync(
    `SELECT COALESCE(SUM(calories), 0) AS calories,
            COALESCE(SUM(protein), 0) AS protein,
            COALESCE(SUM(carbs), 0) AS carbs,
            COALESCE(SUM(fat), 0) AS fat
     FROM intake_logs
     WHERE date BETWEEN ? AND ?`,
    start,
    end,
  );
  const dayCount = inclusiveDayCount(start, end);

  return {
    calories: Number(totals.calories),
    protein: Number(totals.protein),
    carbs: Number(totals.carbs),
    fat: Number(totals.fat),
    dayCount,
    averageCalories: Number(totals.calories) / dayCount,
    averageProtein: Number(totals.protein) / dayCount,
    averageCarbs: Number(totals.carbs) / dayCount,
    averageFat: Number(totals.fat) / dayCount,
  };
}

function searchFoods(database, query) {
  return database.getAllSync(
    `SELECT id, name, calories, protein, carbs, fat
     FROM foods
     WHERE name LIKE ? COLLATE NOCASE
     ORDER BY name COLLATE NOCASE
     LIMIT 60`,
    `%${query.trim()}%`,
  );
}

function formatNumber(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function formatDay(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function capitalizeName(name) {
  return name.replace(
    /(^|[\s'-])([a-z])/g,
    (_match, separator, letter) => separator + letter.toUpperCase(),
  );
}

function ActionButton({
  themeStyles,
  label,
  onPress,
  runWithLoading,
  showLoading = false,
  variant = "primary",
  disabled = false,
  style,
}) {
  const buttonStyle =
    variant === "primary"
      ? themeStyles.primaryButton
      : variant === "danger"
        ? themeStyles.dangerButton
        : themeStyles.secondaryButton;
  const textStyle =
    variant === "primary"
      ? themeStyles.primaryButtonText
      : variant === "danger"
        ? themeStyles.dangerButtonText
        : themeStyles.secondaryButtonText;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={showLoading ? () => runWithLoading(() => onPress()) : onPress}
      style={({ pressed }) => [
        buttonStyle,
        style,
        disabled && themeStyles.disabledButton,
        pressed && !disabled && themeStyles.pressedButton,
      ]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function BackButton({ themeStyles, onPress, runWithLoading }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={() => runWithLoading(onPress)}
      style={themeStyles.backButton}
    >
      <Text style={themeStyles.backArrow}>‹</Text>
      <Text style={themeStyles.backLabel}>Back</Text>
    </Pressable>
  );
}

function SectionHeading({ themeStyles, title, detail }) {
  return (
    <View style={themeStyles.sectionHeading}>
      <Text style={themeStyles.sectionTitle}>{title}</Text>
      {detail ? <Text style={themeStyles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

function MacroValue({ themeStyles, label, value, color }) {
  return (
    <View style={themeStyles.macroValue}>
      <Text style={[themeStyles.macroAmount, { color }]}>
        {formatNumber(value, 1)}g
      </Text>
      <Text style={themeStyles.macroLabel}>{label}</Text>
    </View>
  );
}

function App() {
  const [initialization] = useState(() => {
    try {
      const { database, themeMode, userName } = initializeDatabase();
      const [rangeStart, rangeEnd] = lastSevenDates();
      return {
        database,
        dashboard: getDashboardSnapshot(database),
        rangeSummary: getRangeSummary(database, rangeStart, rangeEnd),
        rangeStart,
        rangeEnd,
        themeMode,
        userName,
        errorMessage: "",
      };
    } catch (error) {
      console.error("Could not initialize the food diary database:", error);
      return {
        database: null,
        dashboard: { todayLogs: [], weeklyStats: [] },
        rangeSummary: null,
        rangeStart: lastSevenDates()[0],
        rangeEnd: localDateString(),
        themeMode: "light",
        userName: "",
        errorMessage:
          "The local food database could not be opened. Please restart the app.",
      };
    }
  });
  const database = initialization.database;
  const [themeMode, setThemeMode] = useState(initialization.themeMode);
  const COLORS = resolveColors(themeMode);
  const styles = useMemo(() => createStyles(COLORS), [COLORS]);
  const [themeOpacity] = useState(() => new Animated.Value(1));
  const [screen, setScreen] = useState("HOME");
  const [userName, setUserName] = useState(initialization.userName);
  const [nameDraft, setNameDraft] = useState("");
  const [splashVisible, setSplashVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [todayLogs, setTodayLogs] = useState(
    initialization.dashboard.todayLogs,
  );
  const [selectedMealsDate, setSelectedMealsDate] = useState(localDateString());
  const [selectedDayLogs, setSelectedDayLogs] = useState(
    initialization.dashboard.todayLogs,
  );
  const [weeklyStats, setWeeklyStats] = useState(
    initialization.dashboard.weeklyStats,
  );
  const [rangeMode, setRangeMode] = useState("7d");
  const [rangeStart, setRangeStart] = useState(initialization.rangeStart);
  const [rangeEnd, setRangeEnd] = useState(initialization.rangeEnd);
  const [customRangeStart, setCustomRangeStart] = useState(
    initialization.rangeStart,
  );
  const [customRangeEnd, setCustomRangeEnd] = useState(initialization.rangeEnd);
  const [rangeSummary, setRangeSummary] = useState(initialization.rangeSummary);
  const [activeHomeCard, setActiveHomeCard] = useState(0);
  const homePagerRef = useRef(null);
  const { width: windowWidth } = useWindowDimensions();
  const homePageWidth = Math.max(280, windowWidth - 40);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodResults, setFoodResults] = useState([]);
  const [selectedFood, setSelectedFood] = useState(null);
  const [servingGrams, setServingGrams] = useState("100");
  const [mealType, setMealType] = useState(null);
  const [editingLog, setEditingLog] = useState(null);
  const [purgeDate, setPurgeDate] = useState(localDateString());
  const [errorMessage, setErrorMessage] = useState(initialization.errorMessage);

  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), 850);
    return () => clearTimeout(timer);
  }, []);

  function runWithLoading(action) {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setTimeout(() => {
      try {
        action();
      } finally {
        setTimeout(() => {
          loadingRef.current = false;
          setLoading(false);
        }, 250);
      }
    }, 80);
  }

  function saveUserName() {
    const name = nameDraft.trim();
    if (!name) {
      Alert.alert("Add your name", "Please tell us what we should call you.");
      return;
    }
    if (name.length > 15 || !/^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/.test(name)) {
      Alert.alert(
        "Check your name",
        "Use up to 15 Roman letters. Spaces, apostrophes, and hyphens are allowed.",
      );
      return;
    }
    if (!database) {
      Alert.alert(
        "Profile unavailable",
        "Your name could not be saved because the local database is unavailable.",
      );
      return;
    }
    try {
      database.runSync(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        "user_name",
        name,
      );
      setUserName(name);
    } catch (error) {
      console.error("Could not save the profile name:", error);
      Alert.alert(
        "Name not saved",
        "Your name could not be saved. Please try again.",
      );
    }
  }

  function refreshDashboard(db = database) {
    if (!db) {
      return;
    }
    try {
      const snapshot = getDashboardSnapshot(db);
      const summary = getRangeSummary(db, rangeStart, rangeEnd);
      const selectedLogs =
        selectedMealsDate === localDateString()
          ? snapshot.todayLogs
          : getLogsForDate(db, selectedMealsDate);
      setTodayLogs(snapshot.todayLogs);
      setWeeklyStats(snapshot.weeklyStats);
      setSelectedDayLogs(selectedLogs);
      setRangeSummary(summary);
      setErrorMessage("");
    } catch (error) {
      console.error("Could not load food diary data:", error);
      setErrorMessage(
        "Your diary could not be loaded. Please restart the app and try again.",
      );
    }
  }

  useEffect(() => {
    if (initialization.errorMessage) {
      Alert.alert("Database unavailable", initialization.errorMessage);
    }
  }, [initialization.errorMessage]);

  const resetEntryForm = useCallback(() => {
    setFoodQuery("");
    setSelectedFood(null);
    setServingGrams("100");
    setMealType(null);
    setEditingLog(null);
  }, []);

  const goBack = useCallback(() => {
    if (screen === "ADD") resetEntryForm();
    setScreen("HOME");
  }, [resetEntryForm, screen]);

  function changeThemeMode() {
    const nextMode = getNextThemeMode(themeMode);
    try {
      database.runSync(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        "theme_mode",
        nextMode,
      );
      Animated.timing(themeOpacity, {
        toValue: 0.45,
        duration: 120,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setThemeMode(nextMode);
          Animated.timing(themeOpacity, {
            toValue: 1,
            duration: 240,
            useNativeDriver: true,
          }).start();
        }
      });
    } catch (error) {
      console.error("Could not save the appearance preference:", error);
      Alert.alert(
        "Appearance not saved",
        "Your color mode could not be saved. Please try again.",
      );
    }
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          screen !== "HOME" &&
          gestureState.x0 <= 28 &&
          gestureState.dx > 12 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.25,
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dx >= 72) {
            goBack();
          }
        },
      }),
    [goBack, screen],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (screen === "HOME") {
          return false;
        }
        goBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [goBack, screen]);

  function openAddScreen() {
    resetEntryForm();
    try {
      setFoodResults(searchFoods(database, ""));
    } catch (error) {
      console.error("Could not load the food library:", error);
      Alert.alert(
        "Food library unavailable",
        "The food library could not be loaded.",
      );
      return;
    }
    setScreen("ADD");
  }

  function changeFoodQuery(query) {
    setFoodQuery(query);
    try {
      setFoodResults(searchFoods(database, query));
    } catch (error) {
      console.error("Could not search the food library:", error);
      Alert.alert(
        "Search unavailable",
        "The food library could not be searched.",
      );
    }
  }

  function chooseDifferentFood() {
    runWithLoading(() => {
      setSelectedFood(null);
      changeFoodQuery("");
    });
  }

  function openEditScreen(log) {
    setEditingLog(log);
    setSelectedFood({
      name: log.food_name,
      calories: (log.calories * 100) / log.serving_qty,
      protein: (log.protein * 100) / log.serving_qty,
      carbs: (log.carbs * 100) / log.serving_qty,
      fat: (log.fat * 100) / log.serving_qty,
    });
    setServingGrams(String(log.serving_qty));
    setMealType(log.meal_type);
    setFoodQuery("");
    setScreen("ADD");
  }

  function saveFoodEntry() {
    const grams = Number(servingGrams);
    if (!mealType) {
      Alert.alert("Choose a meal", "Select a meal before saving your food.");
      return;
    }
    if (!selectedFood) {
      Alert.alert(
        "Choose a food",
        "Search for and select a food before saving.",
      );
      return;
    }
    if (!Number.isFinite(grams) || grams <= 0 || grams > 10000) {
      Alert.alert(
        "Check serving size",
        "Enter a serving weight between 0 and 10,000 grams.",
      );
      return;
    }

    const factor = grams / 100;
    const values = [
      selectedFood.calories * factor,
      selectedFood.protein * factor,
      selectedFood.carbs * factor,
      selectedFood.fat * factor,
      grams,
    ];

    try {
      if (editingLog) {
        database.runSync(
          `UPDATE intake_logs
           SET meal_type = ?, food_name = ?, calories = ?, protein = ?, carbs = ?, fat = ?, serving_qty = ?
           WHERE id = ?`,
          mealType,
          selectedFood.name,
          ...values,
          editingLog.id,
        );
      } else {
        database.runSync(
          `INSERT INTO intake_logs (date, meal_type, food_name, calories, protein, carbs, fat, serving_qty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          localDateString(),
          mealType,
          selectedFood.name,
          ...values,
        );
      }
      refreshDashboard();
      resetEntryForm();
      setScreen("HOME");
    } catch (error) {
      console.error("Could not save the food entry:", error);
      Alert.alert(
        "Could not save entry",
        "Your food entry was not saved. Please try again.",
      );
    }
  }

  function confirmDelete(log) {
    Alert.alert(
      "Delete food entry?",
      `Remove ${log.food_name} from ${formatDay(log.date)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            runWithLoading(() => {
              try {
                database.runSync(
                  "DELETE FROM intake_logs WHERE id = ?",
                  log.id,
                );
                refreshDashboard();
              } catch (error) {
                console.error("Could not delete the food entry:", error);
                Alert.alert(
                  "Could not delete entry",
                  "The entry was not deleted. Please try again.",
                );
              }
            }, "Deleting meal...");
          },
        },
      ],
    );
  }

  function confirmPurge() {
    if (!isValidDate(purgeDate)) {
      Alert.alert("Check the date", "Enter a valid date using YYYY-MM-DD.");
      return;
    }
    Alert.alert(
      "Clear older food logs?",
      `This permanently deletes entries dated before ${purgeDate}. Entries on that date will be kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete older logs",
          style: "destructive",
          onPress: () => {
            runWithLoading(() => {
              try {
                const result = database.runSync(
                  "DELETE FROM intake_logs WHERE date < ?",
                  purgeDate,
                );
                refreshDashboard();
                Alert.alert(
                  "Storage cleaned",
                  `${result.changes} older ${result.changes === 1 ? "entry was" : "entries were"} deleted.`,
                );
                setScreen("HOME");
              } catch (error) {
                console.error("Could not purge older food logs:", error);
                Alert.alert(
                  "Could not clear logs",
                  "No entries were deleted. Please try again.",
                );
              }
            }, "Deleting older meals...");
          },
        },
      ],
    );
  }

  const todayCalories = todayLogs.reduce(
    (total, log) => total + Number(log.calories),
    0,
  );
  const todayProtein = todayLogs.reduce(
    (total, log) => total + Number(log.protein),
    0,
  );
  const todayCarbs = todayLogs.reduce(
    (total, log) => total + Number(log.carbs),
    0,
  );
  const todayFat = todayLogs.reduce((total, log) => total + Number(log.fat), 0);
  const weekCalories = weeklyStats.reduce(
    (total, day) => total + day.calories,
    0,
  );
  const weekAverage = weekCalories / 7;
  const peakDayCalories = Math.max(
    0,
    ...weeklyStats.map((day) => day.calories),
  );
  const today = localDateString();

  function applyDateRange(start, end) {
    if (!database) {
      return false;
    }
    try {
      const summary = getRangeSummary(database, start, end);
      setRangeSummary(summary);
      setRangeStart(start);
      setRangeEnd(end);
      return true;
    } catch (error) {
      console.error("Could not calculate the selected date range:", error);
      Alert.alert(
        "Could not load date range",
        "The food totals for this date range could not be calculated.",
      );
      return false;
    }
  }

  function selectPresetRange(dayCount) {
    const [start, end] = dateRangeEndingToday(dayCount);
    if (applyDateRange(start, end)) {
      setRangeMode(dayCount === 7 ? "7d" : "30d");
    }
  }

  function applyCustomDateRange() {
    if (!isValidDate(customRangeStart) || !isValidDate(customRangeEnd)) {
      Alert.alert(
        "Check the dates",
        "Enter valid start and end dates using YYYY-MM-DD.",
      );
      return;
    }
    if (customRangeStart > customRangeEnd) {
      Alert.alert(
        "Check the date range",
        "The start date must be on or before the end date.",
      );
      return;
    }
    if (applyDateRange(customRangeStart, customRangeEnd)) {
      setRangeMode("custom");
    }
  }

  function openMealsForDate(date) {
    if (!database) {
      return false;
    }
    try {
      const logs = getLogsForDate(database, date);
      setSelectedMealsDate(date);
      setSelectedDayLogs(logs);
      return true;
    } catch (error) {
      console.error("Could not load meals for the selected date:", error);
      Alert.alert(
        "Could not load meals",
        "Meals for this date could not be loaded. Please try again.",
      );
      return false;
    }
  }

  function renderMealsCard() {
    const isToday = selectedMealsDate === today;
    return (
      <View style={[styles.card, styles.pagerCard]}>
        <SectionHeading
          themeStyles={styles}
          title={isToday ? "Today's meals" : "Meals on this day"}
          detail={formatDay(selectedMealsDate)}
        />
        <Text style={styles.mealsCardDetail}>
          {selectedDayLogs.length}{" "}
          {selectedDayLogs.length === 1 ? "entry" : "entries"} logged
        </Text>
        {MEALS.map((meal) => {
          const logs = selectedDayLogs.filter((log) => log.meal_type === meal);
          return (
            <View key={meal} style={styles.mealSection}>
              <View style={styles.mealHeading}>
                <Text style={styles.mealTitle}>{MEAL_LABELS[meal]}</Text>
                <Text style={styles.mealCalories}>
                  {formatNumber(
                    logs.reduce((sum, log) => sum + Number(log.calories), 0),
                    0,
                  )}{" "}
                  kcal
                </Text>
              </View>
              {logs.length ? (
                logs.map((log) => (
                  <View key={log.id} style={styles.foodLogRow}>
                    <View style={styles.foodLogDetails}>
                      <Text numberOfLines={1} style={styles.foodLogName}>
                        {log.food_name}
                      </Text>
                      <Text style={styles.foodLogServing}>
                        {formatNumber(log.serving_qty, 1)} g serving
                      </Text>
                    </View>
                    <Text style={styles.foodLogCalories}>
                      {formatNumber(log.calories, 1)} kcal
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${log.food_name}`}
                      onPress={() => runWithLoading(() => openEditScreen(log))}
                      style={styles.smallAction}
                    >
                      <Text style={styles.editAction}>EDIT</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${log.food_name}`}
                      onPress={() => confirmDelete(log)}
                      style={styles.smallAction}
                    >
                      <Text style={styles.deleteAction}>×</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyMeal}>No entries yet</Text>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  function renderHome() {
    return (
      <ScrollView
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Text style={styles.eyebrow}>OFFLINE FOOD DIARY</Text>
            <Text style={styles.pageTitle}>
              Hi {capitalizeName(userName)}! What&apos;s on the menu today?
            </Text>
            <Text style={styles.homeDateText}>{formatDay(today)}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Color mode: ${themeMode}. Tap to change color mode.`}
              onPress={changeThemeMode}
              disabled={!database}
              style={styles.themeButton}
            >
              <Image
                source={themeMode === "light" ? lightThemeIcon : darkThemeIcon}
                resizeMode="contain"
                style={styles.themeIcon}
              />
            </Pressable>
            {/* <View style={styles.statusBadge}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>LOCAL</Text>
            </View> */}
          </View>
        </View>

        {errorMessage ? (
          <Text style={styles.errorBanner}>{errorMessage}</Text>
        ) : null}

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>TOTAL ENERGY</Text>
          <View style={styles.calorieRow}>
            <Text style={styles.calorieNumber}>
              {formatNumber(todayCalories, 1)}
            </Text>
            <Text style={styles.calorieUnit}>kcal</Text>
          </View>
          <Text style={styles.heroCaption}>
            from {todayLogs.length} logged{" "}
            {todayLogs.length === 1 ? "item" : "items"}
          </Text>
          <View style={styles.macroRow}>
            <MacroValue
              themeStyles={styles}
              label="PROTEIN"
              value={todayProtein}
              color={COLORS.electricCyan}
            />
            <MacroValue
              themeStyles={styles}
              label="CARBS"
              value={todayCarbs}
              color={COLORS.pinkText}
            />
            <MacroValue
              themeStyles={styles}
              label="FAT"
              value={todayFat}
              color={COLORS.neonMint}
            />
          </View>
          <ActionButton
            themeStyles={styles}
            runWithLoading={runWithLoading}
            showLoading
            label="+  Add food"
            onPress={openAddScreen}
            disabled={!database}
            style={styles.heroButton}
          />
        </View>

        <View style={styles.homePagerNavigation}>
          <Text style={styles.homePagerHint}>SWIPE TO EXPLORE</Text>
          <View style={styles.homePagerTabs}>
            {["7-day history", "Date range totals", "Today's meals"].map(
              (label, index) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${label}`}
                  accessibilityState={{ selected: activeHomeCard === index }}
                  onPress={() => {
                    homePagerRef.current?.scrollTo({
                      x: homePageWidth * index,
                      animated: true,
                    });
                    setActiveHomeCard(index);
                  }}
                  style={[
                    styles.homePagerTab,
                    activeHomeCard === index && styles.homePagerTabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.homePagerTabText,
                      activeHomeCard === index && styles.homePagerTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
        </View>

        <ScrollView
          ref={homePagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.homePager}
          onMomentumScrollEnd={(event) => {
            const page = Math.round(
              event.nativeEvent.contentOffset.x / homePageWidth,
            );
            setActiveHomeCard(Math.max(0, Math.min(2, page)));
          }}
        >
          <View style={[styles.homePage, { width: homePageWidth }]}>
            <View style={[styles.card, styles.pagerCard]}>
              <SectionHeading
                themeStyles={styles}
                title="Last 7 days"
                detail="Daily calorie intake"
              />
              <View style={styles.weekSummary}>
                <View>
                  <Text style={styles.metricValue}>
                    {formatNumber(weekAverage, 0)}
                  </Text>
                  <Text style={styles.metricLabel}>AVG KCAL / DAY</Text>
                </View>
                <View style={styles.weekTotal}>
                  <Text style={styles.weekTotalValue}>
                    {formatNumber(weekCalories, 0)}
                  </Text>
                  <Text style={styles.metricLabel}>TOTAL KCAL</Text>
                </View>
              </View>
              <View style={styles.chart}>
                {weeklyStats.map((day) => {
                  const height = day.calories
                    ? Math.max(
                        6,
                        Math.round(
                          (day.calories / (peakDayCalories || 1)) * 64,
                        ),
                      )
                    : 3;
                  const isToday = day.date === today;
                  return (
                    <Pressable
                      key={day.date}
                      accessibilityRole="button"
                      accessibilityLabel={`Show meals for ${formatDay(day.date)}`}
                      onPress={() =>
                        runWithLoading(() => {
                          if (openMealsForDate(day.date)) {
                            homePagerRef.current?.scrollTo({
                              x: homePageWidth * 2,
                              animated: true,
                            });
                            setActiveHomeCard(2);
                          }
                        }, "Loading meals...")
                      }
                      style={styles.chartDay}
                    >
                      <Text style={styles.chartCalories}>
                        {day.calories ? formatNumber(day.calories, 0) : "—"}
                      </Text>
                      <View style={styles.chartTrack}>
                        <View
                          style={[
                            styles.chartBar,
                            {
                              height,
                              backgroundColor: isToday
                                ? COLORS.electricMagenta
                                : COLORS.vibrantPurple,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.chartLabel,
                          isToday && styles.chartLabelToday,
                        ]}
                      >
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" },
                        )}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.weekMacroRow}>
                <Text style={styles.weekMacroText}>
                  7-day protein{" "}
                  <Text style={styles.weekMacroAccent}>
                    {formatNumber(
                      weeklyStats.reduce((sum, day) => sum + day.protein, 0),
                      1,
                    )}
                    g
                  </Text>
                </Text>
                <Text style={styles.weekMacroText}>
                  Carbs{" "}
                  <Text style={styles.weekMacroAccent}>
                    {formatNumber(
                      weeklyStats.reduce((sum, day) => sum + day.carbs, 0),
                      1,
                    )}
                    g
                  </Text>
                </Text>
                <Text style={styles.weekMacroText}>
                  Fat{" "}
                  <Text style={styles.weekMacroAccent}>
                    {formatNumber(
                      weeklyStats.reduce((sum, day) => sum + day.fat, 0),
                      1,
                    )}
                    g
                  </Text>
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.homePage, { width: homePageWidth }]}>
            <View style={[styles.card, styles.pagerCard]}>
              <SectionHeading
                themeStyles={styles}
                title="Date range"
                detail={`${formatDay(rangeStart)} to ${formatDay(rangeEnd)}`}
              />
              <View style={styles.rangeFilters}>
                {[
                  { key: "7d", label: "Last 7 days", days: 7 },
                  { key: "30d", label: "Last 30 days", days: 30 },
                  { key: "custom", label: "Custom", days: null },
                ].map((filter) => {
                  const selected = rangeMode === filter.key;
                  return (
                    <Pressable
                      key={filter.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (filter.days) {
                          runWithLoading(() => selectPresetRange(filter.days));
                        } else {
                          setRangeMode("custom");
                        }
                      }}
                      style={[
                        styles.rangeFilter,
                        selected && styles.rangeFilterSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.rangeFilterText,
                          selected && styles.rangeFilterTextSelected,
                        ]}
                      >
                        {filter.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {rangeMode === "custom" ? (
                <View style={styles.customRange}>
                  <TextInput
                    accessibilityLabel="Custom range start date"
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setCustomRangeStart}
                    placeholder="Start YYYY-MM-DD"
                    placeholderTextColor={COLORS.textSecondary}
                    style={[styles.textInput, styles.rangeDateInput]}
                    value={customRangeStart}
                  />
                  <TextInput
                    accessibilityLabel="Custom range end date"
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setCustomRangeEnd}
                    placeholder="End YYYY-MM-DD"
                    placeholderTextColor={COLORS.textSecondary}
                    style={[styles.textInput, styles.rangeDateInput]}
                    value={customRangeEnd}
                  />
                  <ActionButton
                    themeStyles={styles}
                    runWithLoading={runWithLoading}
                    showLoading
                    label="Apply range"
                    onPress={applyCustomDateRange}
                    disabled={!database}
                    style={styles.applyRangeButton}
                  />
                </View>
              ) : null}
              {rangeSummary ? (
                <View style={styles.rangeMetrics}>
                  {[
                    {
                      label: "Calories",
                      unit: "kcal",
                      total: rangeSummary.calories,
                      average: rangeSummary.averageCalories,
                    },
                    {
                      label: "Protein",
                      unit: "g",
                      total: rangeSummary.protein,
                      average: rangeSummary.averageProtein,
                    },
                    {
                      label: "Carbs",
                      unit: "g",
                      total: rangeSummary.carbs,
                      average: rangeSummary.averageCarbs,
                    },
                    {
                      label: "Fat",
                      unit: "g",
                      total: rangeSummary.fat,
                      average: rangeSummary.averageFat,
                    },
                  ].map((metric) => (
                    <View key={metric.label} style={styles.rangeMetric}>
                      <Text style={styles.rangeMetricHeading}>
                        {metric.label}
                      </Text>
                      <View style={styles.rangeMetricStats}>
                        <View style={styles.rangeMetricStat}>
                          <Text style={styles.rangeMetricLabel}>Total</Text>
                          <Text style={styles.rangeMetricValue}>
                            {formatNumber(metric.total, 1)} {metric.unit}
                          </Text>
                        </View>
                        <View style={styles.rangeMetricStat}>
                          <Text style={styles.rangeMetricLabel}>Per day</Text>
                          <Text style={styles.rangeMetricValue}>
                            {formatNumber(metric.average, 1)} {metric.unit}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyMeal}>
                  Range totals are unavailable until the database is opened.
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.homePage, { width: homePageWidth }]}>
            {renderMealsCard()}
          </View>
        </ScrollView>

        <ActionButton
          themeStyles={styles}
          runWithLoading={runWithLoading}
          showLoading
          label="Storage maintenance"
          onPress={() => {
            setPurgeDate(today);
            setScreen("MAINTENANCE");
          }}
          variant="secondary"
          style={styles.maintenanceLink}
        />
      </ScrollView>
    );
  }

  function renderFoodSearch() {
    return (
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
        >
          <BackButton
            themeStyles={styles}
            onPress={goBack}
            runWithLoading={runWithLoading}
          />
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Text style={styles.eyebrow}>
                {editingLog ? "UPDATE ENTRY" : "NEW ENTRY"}
              </Text>
              <Text style={styles.pageTitle}>
                {editingLog ? "Edit your food" : "Add to your day."}
              </Text>
              <Text style={styles.subtleText}>
                Food values are stored per 100 g.
              </Text>
            </View>
          </View>

          <Text style={styles.inputLabel}>CHOOSE MEAL</Text>
          <View style={styles.mealChips}>
            {MEALS.map((meal) => (
              <Pressable
                key={meal}
                accessibilityRole="button"
                accessibilityState={{ selected: mealType === meal }}
                onPress={() => runWithLoading(() => setMealType(meal))}
                style={[
                  styles.mealChip,
                  styles.entryMealChip,
                  mealType === meal && styles.mealChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.mealChipText,
                    mealType === meal && styles.mealChipTextSelected,
                  ]}
                >
                  {MEAL_LABELS[meal]}
                </Text>
              </Pressable>
            ))}
          </View>

          {!mealType ? (
            <View style={styles.chooseMealPrompt}>
              <Text style={styles.chooseMealPromptText}>
                Choose a meal to browse the food library.
              </Text>
            </View>
          ) : selectedFood ? (
            <>
              <View style={styles.selectedFoodCard}>
                <Text style={styles.eyebrow}>SELECTED FOOD</Text>
                <Text style={styles.selectedFoodName}>{selectedFood.name}</Text>
                <Text style={styles.selectedFoodCalories}>
                  {formatNumber(selectedFood.calories, 1)} kcal / 100 g
                </Text>
                <View style={styles.selectedMacros}>
                  <Text style={styles.selectedMacroText}>
                    P {formatNumber(selectedFood.protein, 1)}g
                  </Text>
                  <Text style={styles.selectedMacroText}>
                    C {formatNumber(selectedFood.carbs, 1)}g
                  </Text>
                  <Text style={styles.selectedMacroText}>
                    F {formatNumber(selectedFood.fat, 1)}g
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={chooseDifferentFood}
                style={styles.changeFoodButton}
              >
                <Text style={styles.changeFood}>Choose a different food</Text>
              </Pressable>
              <Text style={styles.inputLabel}>SERVING SIZE (GRAMS)</Text>
              <TextInput
                accessibilityLabel="Serving size in grams"
                keyboardType="decimal-pad"
                onChangeText={setServingGrams}
                placeholder="100"
                placeholderTextColor={COLORS.textSecondary}
                style={styles.textInput}
                value={servingGrams}
              />
            </>
          ) : (
            <>
              <Text style={styles.inputLabel}>SEARCH FOOD LIBRARY</Text>
              <TextInput
                accessibilityLabel="Search foods"
                autoCapitalize="none"
                onChangeText={changeFoodQuery}
                placeholder="Try “tempe”, “rice”, “egg”…"
                placeholderTextColor={COLORS.textSecondary}
                returnKeyType="search"
                style={styles.textInput}
                value={foodQuery}
              />
              <Text style={styles.resultCount}>
                {foodQuery
                  ? `${foodResults.length} matching foods`
                  : "Browse the local food library"}
              </Text>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={styles.resultsList}
              >
                {foodResults.map((food) => (
                  <Pressable
                    key={food.id}
                    onPress={() => setSelectedFood(food)}
                    style={({ pressed }) => [
                      styles.foodResult,
                      pressed && styles.pressedResult,
                    ]}
                  >
                    <View style={styles.foodResultInfo}>
                      <Text numberOfLines={1} style={styles.foodResultName}>
                        {food.name}
                      </Text>
                      <Text style={styles.foodResultMacros}>
                        P {formatNumber(food.protein, 1)}g · C{" "}
                        {formatNumber(food.carbs, 1)}g · F{" "}
                        {formatNumber(food.fat, 1)}g
                      </Text>
                    </View>
                    <Text style={styles.foodResultCalories}>
                      {formatNumber(food.calories, 0)}
                      <Text style={styles.foodResultUnit}> kcal</Text>
                    </Text>
                  </Pressable>
                ))}
                {!foodResults.length ? (
                  <Text style={styles.emptyResults}>
                    No foods found. Try another search.
                  </Text>
                ) : null}
              </ScrollView>
            </>
          )}

          {mealType && selectedFood && Number(servingGrams) > 0 ? (
            <View style={styles.estimateCard}>
              <Text style={styles.estimateLabel}>
                ESTIMATED FOR {formatNumber(Number(servingGrams), 1)} G
              </Text>
              <Text style={styles.estimateCalories}>
                {formatNumber(
                  (selectedFood.calories * Number(servingGrams)) / 100,
                  1,
                )}{" "}
                kcal
              </Text>
              <Text style={styles.estimateMacros}>
                P{" "}
                {formatNumber(
                  (selectedFood.protein * Number(servingGrams)) / 100,
                  1,
                )}
                g{"  ·  "}C{" "}
                {formatNumber(
                  (selectedFood.carbs * Number(servingGrams)) / 100,
                  1,
                )}
                g{"  ·  "}F{" "}
                {formatNumber(
                  (selectedFood.fat * Number(servingGrams)) / 100,
                  1,
                )}
                g
              </Text>
            </View>
          ) : null}

          {mealType && selectedFood ? (
            <ActionButton
              themeStyles={styles}
              runWithLoading={runWithLoading}
              showLoading
              label={editingLog ? "Save changes" : "Save food entry"}
              onPress={saveFoodEntry}
              disabled={!database}
              style={styles.saveButton}
            />
          ) : null}
        </ScrollView>
      </View>
    );
  }

  function renderMaintenance() {
    return (
      <ScrollView
        contentContainerStyle={styles.pageContent}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton
          themeStyles={styles}
          onPress={goBack}
          runWithLoading={runWithLoading}
        />
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Text style={styles.eyebrow}>LOCAL STORAGE</Text>
            <Text style={styles.pageTitle}>Clean up your diary.</Text>
            <Text style={styles.subtleText}>
              Food reference data will not be removed.
            </Text>
          </View>
        </View>

        <View style={styles.maintenanceCard}>
          <View style={styles.warningIcon}>
            <Text style={styles.warningIconText}>!</Text>
          </View>
          <Text style={styles.maintenanceTitle}>Remove older entries</Text>
          <Text style={styles.maintenanceDescription}>
            Permanently delete food logs from before a date you choose. Entries
            on the selected date stay in your diary.
          </Text>
          <Text style={styles.inputLabel}>KEEP ENTRIES FROM THIS DATE</Text>
          <TextInput
            accessibilityLabel="Keep entries from date"
            autoCapitalize="none"
            keyboardType={
              Platform.OS === "ios" ? "numbers-and-punctuation" : "default"
            }
            onChangeText={setPurgeDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.textInput}
            value={purgeDate}
          />
          <Text style={styles.dateHint}>
            Format: YYYY-MM-DD · Example: 2026-01-01
          </Text>
          <ActionButton
            themeStyles={styles}
            label="Delete older logs"
            onPress={confirmPurge}
            variant="danger"
            disabled={!database}
            style={styles.purgeButton}
          />
          <ActionButton
            themeStyles={styles}
            label="Keep my data"
            onPress={() => setScreen("HOME")}
            variant="secondary"
          />
        </View>
      </ScrollView>
    );
  }

  function renderSplash() {
    return (
      <View style={styles.splashScreen}>
        <View style={styles.splashMark}>
          <Text style={styles.splashMarkText}>F</Text>
        </View>
        <Text style={styles.splashTitle}>Mindful Bite</Text>
        <Text style={styles.splashSubtitle}>
          Track what you eat. A little more mindful, every day.
        </Text>
        <ActivityIndicator
          color={COLORS.electricMagenta}
          style={styles.splashLoader}
        />
      </View>
    );
  }

  function renderNameSetup() {
    return (
      <View style={styles.welcomeScreen}>
        <Text style={styles.eyebrow}>YOUR FOOD DIARY</Text>
        <Text style={styles.welcomeTitle}>How should we call you?</Text>
        <Text style={styles.welcomeDescription}>
          We’ll use your name to make your daily welcome feel a little more
          personal. It stays on this device.
        </Text>
        <TextInput
          accessibilityLabel="Your name"
          autoCapitalize="words"
          autoComplete="name"
          maxLength={15}
          onChangeText={setNameDraft}
          onSubmitEditing={() => runWithLoading(saveUserName)}
          placeholder="Your name"
          placeholderTextColor={COLORS.textSecondary}
          returnKeyType="done"
          style={styles.textInput}
          value={nameDraft}
        />
        <ActionButton
          themeStyles={styles}
          runWithLoading={runWithLoading}
          showLoading
          label="Let's get started"
          onPress={saveUserName}
          disabled={!database}
          style={styles.welcomeButton}
        />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <ExpoStatusBar style={themeMode === "dark" ? "light" : "dark"} />
      <Animated.View style={[styles.flex, { opacity: themeOpacity }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.flex} {...panResponder.panHandlers}>
            {splashVisible
              ? renderSplash()
              : database && !userName
                ? renderNameSetup()
                : null}
            {!splashVisible && (!database || userName) ? (
              <>
                {screen === "HOME" ? renderHome() : null}
                {screen === "ADD" ? renderFoodSearch() : null}
                {screen === "MAINTENANCE" ? renderMaintenance() : null}
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
      {loading ? (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingModal}>
            <ActivityIndicator
              accessibilityLabel="Loading"
              color={COLORS.loadingSpinner}
              size="large"
            />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default App;
