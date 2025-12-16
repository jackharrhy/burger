import { addEntity, addComponent, removeEntity, query } from "bitecs";
import debugFactory from "debug";
import {
  Order,
  OrderQueue,
  Position,
  NetworkId,
  Networked,
  SittingOn,
} from "@burger-king/shared";
import type { ServerWorld } from "../world";

const debug = debugFactory("burger:server:order-system");

// Order system configuration
const MIN_ORDER_INTERVAL = 10000; // 10 seconds minimum between orders
const MAX_ORDER_INTERVAL = 20000; // 20 seconds maximum between orders
const MAX_ACTIVE_ORDERS = 3; // Maximum orders per window
const MIN_PATTIES_PER_ORDER = 1;
const MAX_PATTIES_PER_ORDER = 3;
const ORDER_TIME_LIMIT = 60000; // 60 seconds to complete order (0 = no limit)

// Track per-window order spawn timers
const windowTimers = new Map<number, number>();

/**
 * Initialize order timers for all order windows
 */
export const initializeOrderSystem = (world: ServerWorld): void => {
  const windows = query(world, [OrderQueue, Position]);

  for (const windowEid of windows) {
    // Set initial timer with random offset to stagger order spawns
    const initialDelay =
      Math.random() * (MAX_ORDER_INTERVAL - MIN_ORDER_INTERVAL) +
      MIN_ORDER_INTERVAL;
    windowTimers.set(windowEid, initialDelay);
    debug("Initialized order window %d with delay %d ms", windowEid, initialDelay);
  }
};

/**
 * Order spawn system - spawns new orders at order windows periodically
 */
export const orderSpawnSystem = (world: ServerWorld, deltaTime: number): void => {
  const windows = query(world, [OrderQueue, Position]);

  for (const windowEid of windows) {
    // Get current timer
    let timer = windowTimers.get(windowEid) ?? 0;
    timer -= deltaTime;

    if (timer <= 0) {
      // Check if we can spawn a new order
      const activeOrders = query(world, [Order, SittingOn(windowEid)]);

      if (activeOrders.length < MAX_ACTIVE_ORDERS) {
        spawnOrder(world, windowEid);
      } else {
        debug(
          "Window %d at max orders (%d/%d)",
          windowEid,
          activeOrders.length,
          MAX_ACTIVE_ORDERS
        );
      }

      // Reset timer with random interval
      timer =
        Math.random() * (MAX_ORDER_INTERVAL - MIN_ORDER_INTERVAL) +
        MIN_ORDER_INTERVAL;
    }

    windowTimers.set(windowEid, timer);
  }
};

/**
 * Order timeout system - removes orders that have expired
 */
export const orderTimeoutSystem = (
  world: ServerWorld,
  deltaTime: number
): void => {
  if (ORDER_TIME_LIMIT <= 0) return; // No time limit

  const orders = query(world, [Order]);

  for (const orderEid of orders) {
    Order.elapsed[orderEid] += deltaTime;

    if (Order.elapsed[orderEid] >= Order.timeLimit[orderEid]) {
      if (Order.timeLimit[orderEid] > 0) {
        debug(
          "Order %d expired (elapsed: %d, limit: %d)",
          orderEid,
          Order.elapsed[orderEid],
          Order.timeLimit[orderEid]
        );
        removeEntity(world, orderEid);
        // TODO: Penalty for failed order
      }
    }
  }
};

/**
 * Spawn a new order at the given window
 */
const spawnOrder = (world: ServerWorld, windowEid: number): void => {
  const orderEid = addEntity(world);

  addComponent(world, orderEid, Order);
  addComponent(world, orderEid, Position);
  addComponent(world, orderEid, NetworkId);
  addComponent(world, orderEid, Networked);
  addComponent(world, orderEid, SittingOn(windowEid));

  // Random number of patties required
  const requiredCount =
    Math.floor(Math.random() * (MAX_PATTIES_PER_ORDER - MIN_PATTIES_PER_ORDER + 1)) +
    MIN_PATTIES_PER_ORDER;

  Order.requiredCount[orderEid] = requiredCount;
  Order.fulfilledCount[orderEid] = 0;
  Order.timeLimit[orderEid] = ORDER_TIME_LIMIT;
  Order.elapsed[orderEid] = 0;

  // Position at window
  Position.x[orderEid] = Position.x[windowEid];
  Position.y[orderEid] = Position.y[windowEid];

  NetworkId.id[orderEid] = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  debug(
    "Spawned order %d at window %d requiring %d patties",
    orderEid,
    windowEid,
    requiredCount
  );
};

/**
 * Get the count of active orders
 */
export const getActiveOrderCount = (world: ServerWorld): number => {
  return query(world, [Order]).length;
};

/**
 * Get orders at a specific window
 */
export const getOrdersAtWindow = (
  world: ServerWorld,
  windowEid: number
): number[] => {
  return query(world, [Order, SittingOn(windowEid)]);
};

