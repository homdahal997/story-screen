import { superdevClient } from "@/lib/superdev/client";

// Export User for authentication flows
export const User = superdevClient.auth;
export const DramaProject = superdevClient.entity("DramaProject");
