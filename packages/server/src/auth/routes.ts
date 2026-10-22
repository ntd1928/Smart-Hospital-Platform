// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { authenticateRequest } from '../oauth/middleware';
import { clientInfoHandler } from './clientinfo';
import { loginHandler, loginValidator } from './login';
import { meHandler } from './me';
import { methodHandler, methodValidator } from './method';
import { profileHandler, profileValidator } from './profile';
import { revokeHandler, revokeValidator } from './revoke';
import { scopeHandler, scopeValidator } from './scope';
import { statusHandler, statusValidator } from './status';

export const authRouter = Router();
authRouter.post('/method', methodValidator, methodHandler);
authRouter.get('/me', authenticateRequest, meHandler);
authRouter.post('/login', loginValidator, loginHandler);
authRouter.post('/profile', profileValidator, profileHandler);
authRouter.post('/scope', scopeValidator, scopeHandler);
authRouter.post('/revoke', authenticateRequest, revokeValidator, revokeHandler);
authRouter.get('/login/:login', statusValidator, statusHandler);
authRouter.get('/clientinfo/:clientId', clientInfoHandler);
