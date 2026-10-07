import * as fn from '../fn.js';
import * as mw from '../mw.js';

import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';

import User from '../model/User.js';

import { mongoose } from '../app.js';

export const router = express.Router();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.use('/', mw.isAdmin);

let inventory_space = { total: 0, items: 0, keys: 0, refs: 0, recs: 0, scraps: 0 };
let potentional_inventory_space = { total: 0, items: 0, keys: 0, refs: 0, recs: 0, scraps: 0 };
let active_bots = [];

/* ========================= ROUTES ========================= */

router.get('/', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`];

  res.render(
    'admin/admin.ejs',
    fn.res_data(true, req.user, user_cookie, 'tf2deal.com - Admin Panel')
  );
});