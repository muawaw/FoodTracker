import pandas as pd

def process_nutrition_csv(input_filepath, output_filepath):
    # Load the CSV file
    df = pd.read_csv(input_filepath)

    # Strip whitespace from column names for safety
    df.columns = df.columns.str.strip()

    # Define macro-to-calorie conversion factors (kcal per gram)
    CALORIES_PER_G_PROTEIN = 4
    CALORIES_PER_G_CARBS = 4
    CALORIES_PER_G_FAT = 9

    # The source dataset stores these nutrients per 100g under different names.
    macro_sources = {
        'protein_g': ('protein_g', 'proteins'),
        'carbs_g': ('carbs_g', 'carbohydrate'),
        'fat_g': ('fat_g', 'fat'),
    }
    for target, candidates in macro_sources.items():
        source = next((column for column in candidates if column in df.columns), None)
        if source is None:
            expected = ', '.join(candidates)
            raise ValueError(f"Missing required nutrient column; expected one of: {expected}")
        df[target] = pd.to_numeric(df[source], errors='raise').fillna(0)

    # Calculate calorie contributions for each macronutrient
    df['protein_calories'] = df['protein_g'] * CALORIES_PER_G_PROTEIN
    df['carbs_calories'] = df['carbs_g'] * CALORIES_PER_G_CARBS
    df['fat_calories'] = df['fat_g'] * CALORIES_PER_G_FAT

    # Compute total estimated calories
    df['calculated_total_calories'] = (
        df['protein_calories'] +
        df['carbs_calories'] +
        df['fat_calories']
    )
    df['calculated_calories_per_gram'] = df['calculated_total_calories'] / 100

    # Save processed dataframe to a new CSV
    df.to_json(output_filepath, orient="records")
    print(f"Successfully processed CSV and saved output to: {output_filepath}")

if __name__ == "__main__":
    # Specify your file paths here
    input_file = "nutrition.csv"
    output_file = "App/assets/food_nutrition_processed.json"

    process_nutrition_csv(input_file, output_file)