/**
 * Next handles stylesheets at build time, but the type checker sees them as imports
 * without declarations. One line per resource type.
 */
declare module "*.css";
