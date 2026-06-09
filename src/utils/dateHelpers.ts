/**
 * Date utility functions for simulation date handling
 */

/**
 * Get the first day of the current year
 */
export function getCurrentYearStart(): Date {
  const currentYear = new Date().getFullYear();
  return new Date(currentYear, 0, 1); // January 1st
}

/**
 * Get the last day of the current year
 */
export function getCurrentYearEnd(): Date {
  const currentYear = new Date().getFullYear();
  return new Date(currentYear, 11, 31); // December 31st
}

/**
 * Get default simulation date range for current year
 */
export function getDefaultSimulationDateRange(): { start: Date; end: Date } {
  return {
    start: getCurrentYearStart(),
    end: getCurrentYearEnd()
  };
}

/**
 * Format date for database (YYYY-MM-DD)
 */
export function formatDateForDatabase(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

/**
 * Get fallback dates when database dates are null
 */
export function getFallbackSimulationDates(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): { start: Date; end: Date } {
  const defaults = getDefaultSimulationDateRange();
  
  return {
    start: startDate ? new Date(startDate) : defaults.start,
    end: endDate ? new Date(endDate) : defaults.end
  };
}