import bcrypt from 'bcryptjs';
import { ROLES, hasRole } from '../domain/roles.mjs';

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function requireRole(user, role) {
  if (!user) {
    throw new Error('Unauthenticated');
  }
  if (hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, role)) {
    return true;
  }
  throw new Error('Forbidden');
}

export function sanitizeSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles
  };
}
