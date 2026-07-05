import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { Roles } from '../common/role.guard';
import { ROLE } from '../common/contracts';
import { MaterialsService } from './materials.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { AddMaterialDto, UpdateMaterialFileDto } from './materials.dto';

@Roles(ROLE.TEACHER)
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService, private readonly bootstrap: BootstrapService) {}

  @Post()
  async add(@CurrentUser() user: AuthUser, @Body() body: AddMaterialDto) {
    await this.materials.add(user, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Delete(':topicId/files/:fileId')
  async remove(@CurrentUser() user: AuthUser, @Param('topicId') topicId: string, @Param('fileId') fileId: string) {
    await this.materials.removeFile(user, topicId, fileId);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }

  @Patch(':topicId/files/:fileId')
  async update(@CurrentUser() user: AuthUser, @Param('topicId') topicId: string, @Param('fileId') fileId: string, @Body() body: UpdateMaterialFileDto) {
    await this.materials.updateFile(user, topicId, fileId, body);
    return { data: await this.bootstrap.buildForUser(user.id) };
  }
}
