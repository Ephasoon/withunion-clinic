import "express-session";
import { AuthenticatedUser } from "../modules/auth/auth.service";

declare module "express-session" {
  interface SessionData {
    user?: AuthenticatedUser;
  }
}
