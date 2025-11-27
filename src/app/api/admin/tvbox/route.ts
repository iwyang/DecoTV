/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  fetchTVBoxConfig,
  mergeTVBoxSites,
  parseTVBoxSites,
  removeTVBoxSites,
} from '@/lib/tvbox';

export const runtime = 'nodejs';

// 鉴权辅助函数
function checkAuth(req: NextRequest) {
  const authInfo = getAuthInfoFromCookie(req);
  if (!authInfo || !authInfo.username) {
    return false;
  }
  // 这里可以添加更严格的权限检查，比如只允许 admin/owner
  return true;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await getConfig();
    return NextResponse.json(config.TVBoxConfig || []);
  } catch (error) {
    console.error('获取 TVBox 订阅失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url, name, autoUpdate } = await req.json();

    if (!url || !name) {
      return NextResponse.json(
        { error: '名称和地址不能为空' },
        { status: 400 }
      );
    }

    // 1. 获取并解析配置
    const tvboxJson = await fetchTVBoxConfig(url);
    const sites = parseTVBoxSites(tvboxJson);

    if (sites.length === 0) {
      return NextResponse.json(
        { error: '该订阅源中没有发现支持的 CMS 接口 (type 0/1)' },
        { status: 400 }
      );
    }

    // 2. 更新配置
    let config = await getConfig();

    // 初始化数组
    if (!config.TVBoxConfig) {
      config.TVBoxConfig = [];
    }

    // 检查是否已存在同名订阅
    const existingIndex = config.TVBoxConfig.findIndex(
      (sub) => sub.name === name
    );
    const newSub = {
      url,
      name,
      autoUpdate: !!autoUpdate,
      addedAt: Date.now(),
    };

    if (existingIndex >= 0) {
      config.TVBoxConfig[existingIndex] = newSub;
    } else {
      config.TVBoxConfig.push(newSub);
    }

    // 3. 合并站点
    config = mergeTVBoxSites(config, sites, name);

    // 4. 保存
    await db.saveAdminConfig(config);
    await setCachedConfig(config);

    return NextResponse.json({
      message: `成功添加订阅，导入了 ${sites.length} 个源`,
      sitesCount: sites.length,
    });
  } catch (error) {
    console.error('添加 TVBox 订阅失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '添加失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: '名称不能为空' }, { status: 400 });
    }

    let config = await getConfig();

    if (!config.TVBoxConfig) {
      return NextResponse.json({ error: '没有订阅配置' }, { status: 404 });
    }

    // 1. 移除订阅记录
    config.TVBoxConfig = config.TVBoxConfig.filter((sub) => sub.name !== name);

    // 2. 移除相关站点
    config = removeTVBoxSites(config, name);

    // 3. 保存
    await db.saveAdminConfig(config);
    await setCachedConfig(config);

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除 TVBox 订阅失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name } = await req.json();

    if (!name) {
      return NextResponse.json({ error: '名称不能为空' }, { status: 400 });
    }

    let config = await getConfig();
    const sub = config.TVBoxConfig?.find((s) => s.name === name);

    if (!sub) {
      return NextResponse.json({ error: '订阅不存在' }, { status: 404 });
    }

    // 1. 重新获取并解析
    const tvboxJson = await fetchTVBoxConfig(sub.url);
    const sites = parseTVBoxSites(tvboxJson);

    if (sites.length === 0) {
      return NextResponse.json(
        { error: '该订阅源中没有发现支持的 CMS 接口' },
        { status: 400 }
      );
    }

    // 2. 更新站点
    config = mergeTVBoxSites(config, sites, name);

    // 3. 保存
    await db.saveAdminConfig(config);
    await setCachedConfig(config);

    return NextResponse.json({
      message: `刷新成功，当前共有 ${sites.length} 个源`,
      sitesCount: sites.length,
    });
  } catch (error) {
    console.error('刷新 TVBox 订阅失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '刷新失败' },
      { status: 500 }
    );
  }
}
