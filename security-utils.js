import { logger } from "./logger.js";

// Constants
export const MAX_PLOT_LENGTH = 5000;
export const MAX_DIRECTION_LENGTH = 500;
export const MIN_FREQUENCY = 1;
export const MAX_FREQUENCY = 100;
export const MIN_HISTORY_LIMIT = 1;
export const MAX_HISTORY_LIMIT = 50;
export const ALLOWED_STYLES = ['natural', 'dramatic', 'romantic', 'mysterious', 'adventure', 'comedy'];
export const ALLOWED_INTENSITIES = ['subtle', 'moderate', 'intense'];

// @ts-ignore - toastr is a global library
const toastr = window.toastr;

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, "&#034;")
        .replace(/'/g, "&#039;");
}

/**
 * Sanitize plot text input
 * @param {string} text - The plot text
 * @param {number} maxLength - Maximum allowed length (default 5000)
 * @returns {string|null} Sanitized text or null if invalid
 */
export function sanitizePlotText(text, maxLength = MAX_PLOT_LENGTH) {
    if (typeof text !== 'string') return null;
    
    let sanitized = text.trim();
    
    if (sanitized.length === 0) return null;
    
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
        if (toastr) toastr.warning(`Plot text truncated to ${maxLength} characters`, 'Machinor Roundtable');
    }
    
    // Remove control characters but keep newlines
    sanitized = sanitized.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    return escapeHtml(sanitized);
}

/**
 * Sanitize direction input
 * @param {string} text - The direction text
 * @param {number} maxLength - Maximum allowed length (default 500)
 * @returns {string|null} Sanitized text or null if invalid
 */
export function sanitizeDirection(text, maxLength = MAX_DIRECTION_LENGTH) {
    if (typeof text !== 'string') return null;
    
    let sanitized = text.trim();
    
    if (sanitized.length === 0) return null;
    
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
        if (toastr) toastr.warning(`Direction text truncated to ${maxLength} characters`, 'Machinor Roundtable');
    }
    
    return escapeHtml(sanitized);
}

/**
 * Validate numeric input with range checking
 * @param {any} value - The input value
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} defaultValue Default value if invalid
 * @returns {number} Validated number
 */
export function validateNumericInput(value, min, max, defaultValue) {
    let num = parseInt(value);
    
    if (isNaN(num)) return defaultValue;
    
    if (num < min) {
        if (toastr) toastr.warning(`Value must be at least ${min}`, 'Machinor Roundtable');
        return min;
    }
    
    if (num > max) {
        if (toastr) toastr.warning(`Value cannot exceed ${max}`, 'Machinor Roundtable');
        return max;
    }
    
    return num;
}

/**
 * Create a centralized error handler factory
 * @param {string} context - The component name context (e.g., 'PlotEngine')
 * @returns {Function} Error handler function
 */
export function createErrorHandler(context) {
    return (error, userMessage = null) => {
        logger.error(`[${context}] Error:`, error);
        
        if (userMessage && toastr) {
            toastr.error(userMessage, 'Machinor Roundtable');
        }
        
        // Additional error telemetry could go here
        return null;
    };
}