export function evaluate24(expression: string): boolean {
    // Simple validation to ensure only numbers and basic operators/parentheses are present
    if (!/^[0-9+\-*/() ]+$/.test(expression)) {
        return false;
    }

    try {
        // Evaluate the expression
        // Using Function instead of eval for slightly better safety, though still risky if input is completely unsanitized. 
        // Here we validated the string first.
        const result = new Function('return ' + expression)();

        // Check if result is 24 or -24 (handle minor floating point inaccuracies)
        return Math.abs(result - 24) < 0.0001 || Math.abs(result + 24) < 0.0001;
    } catch (err) {
        return false;
    }
}
