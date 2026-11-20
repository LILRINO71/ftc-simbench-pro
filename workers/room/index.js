/* The Worker that holds the site's Durable Object classes: the match rooms (bound to
   the Pages site as ROOMS, functions/room) and the shared leaderboard (BOARDS,
   functions/leaderboard). It answers nothing by itself. */
export { RoomDO } from './room.js';
export { BoardDO } from './board.js';

export default {
  fetch() { return new Response('FTC SimBench rooms: reached through the site at /room/', { status: 404 }); },
};
