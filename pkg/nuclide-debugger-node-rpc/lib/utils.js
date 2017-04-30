/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import {getCategoryLogger} from '../../nuclide-logging';

const DEBUGGER_LOGGER_CATEGORY = 'nuclide-debugger-node-rpc';
export default getCategoryLogger(DEBUGGER_LOGGER_CATEGORY);
