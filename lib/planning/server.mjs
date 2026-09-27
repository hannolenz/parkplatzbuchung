import { getDatabase } from '../db/connection.mjs';
import { createBookingRepository } from './repository.mjs';
import { createPlanningService } from './service.mjs';
export function planningService() { return createPlanningService(createBookingRepository(getDatabase())); }
