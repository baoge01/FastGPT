import type { NextApiRequest, NextApiResponse } from 'next';
import { jsonRes } from '@/service/response';
import { connectToDatabase } from '@/service/mongo';
import { authToken } from '@/service/utils/auth';
import { generateVector } from '@/service/events/generateVector';
import { ModelDataStatusEnum } from '@/constants/model';
import { PgClient } from '@/service/pg';
import { authModel } from '@/service/utils/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse<any>) {
  try {
    const { modelId, data } = req.body as {
      modelId: string;
      data: string[][];
    };

    if (!modelId || !Array.isArray(data)) {
      throw new Error('缺少参数');
    }

    // 凭证校验
    const userId = await authToken(req);

    await connectToDatabase();

    // 验证是否是该用户的 model
    await authModel({
      userId,
      modelId
    });

    // 去重
    const searchRes = await Promise.allSettled(
      data.map(async ([q, a = '']) => {
        if (!q) {
          return Promise.reject('q为空');
        }
        try {
          q = q.replace(/\\n/g, '\n');
          a = a.replace(/\\n/g, '\n');
          const count = await PgClient.count('modelData', {
            where: [
              ['user_id', userId],
              'AND',
              ['model_id', modelId],
              'AND',
              ['q', q],
              'AND',
              ['a', a]
            ]
          });
          if (count > 0) {
            return Promise.reject('已经存在');
          }
        } catch (error) {
          error;
        }
        return Promise.resolve({
          q,
          a
        });
      })
    );
    // 过滤重复的内容
    const filterData = searchRes
      .filter((item) => item.status === 'fulfilled')
      .map<{ q: string; a: string }>((item: any) => item.value);

    // 插入 pg
    const insertRes = await PgClient.insert('modelData', {
      values: filterData.map((item) => [
        { key: 'user_id', value: userId },
        { key: 'model_id', value: modelId },
        { key: 'q', value: item.q },
        { key: 'a', value: item.a },
        { key: 'status', value: ModelDataStatusEnum.waiting }
      ])
    });

    generateVector();

    jsonRes(res, {
      data: insertRes.rowCount
    });
  } catch (err) {
    jsonRes(res, {
      code: 500,
      error: err
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb'
    }
  }
};
