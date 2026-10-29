import { registerRoute, startRouter } from './router.js';
import * as login from './screens/login.js';
import * as dieselPrice from './screens/dieselPrice.js';
import * as vendors from './screens/vendors.js';
import * as review from './screens/review.js';
import * as approve from './screens/approve.js';
import * as lookup from './screens/lookup.js';
import * as admin from './screens/admin.js';
import * as changeRequests from './screens/changeRequests.js';

registerRoute('/login', login, { public: true });
registerRoute('/diesel-price', dieselPrice, { roles: ['Rate Maintainer'] });
registerRoute('/vendors', vendors, { roles: ['Rate Maintainer'] });
registerRoute('/review', review, { roles: ['Rate Maintainer'] });
registerRoute('/approve', approve, { roles: ['Approver'] });
registerRoute('/lookup', lookup, { roles: ['Rate Maintainer', 'Approver', 'Display'] });
registerRoute('/admin', admin, { roles: ['Approver'] });
registerRoute('/master-data-requests', changeRequests, { roles: ['Approver'] });

startRouter();
