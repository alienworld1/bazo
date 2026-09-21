import 'server-only';
import { parseEnvironment } from '@/lib/environment';

export function getEnvironment() {
  return parseEnvironment(process.env);
}
