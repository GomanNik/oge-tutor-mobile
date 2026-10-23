import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { MaterialsService } from './materials.service';
import { CatalogService } from '../catalog/catalog.service';
import { AddMaterialDto, UpdateMaterialFileDto } from './materials.dto';

@Roles(ROLE.TEACHER)
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService, private readonly catalog: CatalogService) {}

  @Post()
  async add(@CurrentUser() user: AuthUser, @Body() body: AddMaterialDto) {
    const attachment = await this.materials.add(user, body);
    return { changes: { materials: [await this.catalog.material(user, attachment.topicId)] }, invalidated: ['materials'] };
  }

  @Delete(':topicId/files/:fileId')
  async remove(@CurrentUser() user: AuthUser, @Param('topicId') topicId: string, @Param('fileId') fileId: string) {
    await this.materials.removeFile(user, topicId, fileId);
    return { changes: { materials: [await this.catalog.material(user, topicId)] }, invalidated: ['materials'] };
  }

  @Patch(':topicId/files/:fileId')
  async update(@CurrentUser() user: AuthUser, @Param('topicId') topicId: string, @Param('fileId') fileId: string, @Body() body: UpdateMaterialFileDto) {
    const attachment = await this.materials.updateFile(user, topicId, fileId, body);
    const topicIds = [...new Set([topicId, attachment.topicId])];
    return { changes: { materials: await Promise.all(topicIds.map(id => this.catalog.material(user, id))) }, invalidated: ['materials'] };
  }
}
