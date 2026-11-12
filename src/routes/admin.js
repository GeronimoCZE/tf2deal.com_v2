import * as fn from '../fn.js';
import * as mw from '../mw.js';

import express from 'express';

// /admin: the admin panel page (view/admin/admin.ejs). Its sections load their data from /api/admin/* (api/routes/admin.js).
export const router = express.Router();

router.use('/', mw.isAdmin);

router.get('/', (req, res) => {
  const user_cookie = req.cookies[`td_${req.user.steamid}`];

  res.render(
    'admin/admin.ejs',
    fn.res_data(true, req.user, user_cookie, 'tf2deal.com - Admin Panel')
  );
});