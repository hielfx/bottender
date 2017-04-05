import _debug from 'debug';

import LINEBotAPIClient from '../api/LINEBotAPIClient';
import LINEContext from '../session/LINEContext';
import SessionManager from '../session/SessionManager';
import PersistentMemorySessionStore
  from '../session/PersistentMemorySessionStore';
// import DangerousFileSessionStore from '../session/DangerousFileSessionStore';

const debug = _debug('core/bot/LINEBot');

export default class LINEBot {
  constructor({ accessToken, channelSecret, filePath, messageDelay }) {
    this._messageDelay = messageDelay;
    this._lineAPIClient = LINEBotAPIClient.factory(accessToken, channelSecret);
    this._sessionManager = new SessionManager(
      new PersistentMemorySessionStore(filePath, 500),
    );
    this._initialized = false;
  }

  handle(handler) {
    this._handler = handler;
  }

  // {
  //   "events": [
  //     {
  //       "replyToken": "nHuyWiB7yP5Zw52FIkcQobQuGDXCTA",
  //       "type": "message",
  //       "timestamp": 1462629479859,
  //       "source": {
  //         "type": "user",
  //         "userId": "U206d25c2ea6bd87c17655609a1c37cb8"
  //       },
  //       "message": {
  //         "id": "325708",
  //         "type": "text",
  //         "text": "Hello, world"
  //       }
  //     },
  //     {
  //       "replyToken": "nHuyWiB7yP5Zw52FIkcQobQuGDXCTA",
  //       "type": "follow",
  //       "timestamp": 1462629479859,
  //       "source": {
  //         "type": "user",
  //         "userId": "U206d25c2ea6bd87c17655609a1c37cb8"
  //       }
  //     }
  //   ]
  // }
  createKoaMiddleware() {
    return async ({ request, response }) => {
      debug(JSON.stringify(request.body, null, 2));

      // FIXME: https://github.com/koajs/bodyparser/issues/43#issuecomment-287596020
      // rawBody

      // const signature = request.header['X-Line-Signature'];
      // const isValidSignature = this._lineAPIClient.isValidSignature(rawBody, signature);

      // if (!isValidSignature) {
      //   response.status = 400;
      //   response.body = 'invalid signature';
      //   return;
      // }

      if (!this._initialized) {
        await this._sessionManager.init();
        this._initialized = true;
      }

      const msg = request.body.events[0];
      const senderId = msg.source.userId;

      const {
        sessionData,
        existed,
      } = await this._sessionManager.createSessionDataIfNotExists(senderId);

      const context = new LINEContext({
        lineAPIClient: this._lineAPIClient,
        data: sessionData,
        messageDelay: this._messageDelay,
      });

      if (!existed) {
        const { data } = await this._lineAPIClient.getUserProfile(senderId);
        context.data.user = {
          ...data,
          id: senderId,
        };
      }

      if (!this._handler) {
        throw new Error('must have at least 1 handler');
      }

      // message, follow, unfollow, join, leave, postback, beacon
      const promises = [];
      request.body.events
        .filter(event => ['message'].includes(event.type))
        .forEach(event => {
          promises.push(Promise.resolve(this._handler(context, event)));
        });

      request.body.events
        .filter(event => ['postback'].includes(event.type))
        .forEach(event => {
          event.postback.payload = event.postback.data; // FIXME
          promises.push(Promise.resolve(this._handler(context, event)));
        });

      await Promise.all(promises);

      this._sessionManager.saveSessionData(senderId, context.data);

      response.status = 200;
    };
  }
}