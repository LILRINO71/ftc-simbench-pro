/* The Worker that holds the match rooms' Durable Object class. The Pages site
   binds to it as ROOMS (functions/room); it answers nothing by itself. */
export { RoomDO } from './room.js';

export default {
  fetch() { return new Response('FTC SimBench rooms: reached through the site at /room/', { status: 404 }); },
};
